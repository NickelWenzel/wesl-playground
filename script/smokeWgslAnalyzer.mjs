// Headless smoke test for a wgsl-analyzer wasm build.
//
// Drives the real server exactly as src/lsp/wgslAnalyzer.worker.ts does -- ccall
// wa_push in, wa_emit -> postMessage out -- with no browser. `postMessage` is a
// bare global in the analyzer's wa-io.js, so we supply one. Emscripten's node
// support is compiled in (ENVIRONMENT is unrestricted), so the same artifact the
// browser loads runs here unmodified.
//
//   node script/smokeWgslAnalyzer.mjs                    # committed release build
//   node script/smokeWgslAnalyzer.mjs public/wgsl-analyzer   # local debug build
//
// Exits non-zero if anything fails.

import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = path.resolve(import.meta.dirname, '..')
const dir = path.resolve(repo, process.argv[2] ?? 'src/wgsl-analyzer-web')
const WORKSPACE = '/workspace'

const BINDINGS = `struct Uniforms {
  time: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
`

// Positions below are 0-based and hand-counted against this text.
//              0         1
//              0123456789012345678901
const MAIN = `import package::bindings::uniforms;

fn shade() -> f32 {
  return uniforms.time;
}
`
const USE_OF_UNIFORMS = { line: 3, character: 12 } // inside `uniforms`
const AFTER_DOT = { line: 3, character: 17 } // after `uniforms.`

const pending = new Map()
const notes = []
let nextId = 1

globalThis.postMessage = (msg) => {
  const entry = msg && msg.id !== undefined ? pending.get(msg.id) : undefined
  if (entry) {
    pending.delete(msg.id)
    entry(msg)
  } else {
    notes.push(msg)
  }
}

console.log(`analyzer: ${path.relative(repo, dir) || dir}`)

const { default: createWgslAnalyzer } = await import(
  pathToFileURL(path.join(dir, 'wgsl_analyzer.js')).href
)

let signalReady
const ready = new Promise((r) => (signalReady = r))

const mod = await createWgslAnalyzer({
  thisProgram: '/usr/bin/wgsl-analyzer',
  locateFile: (p) =>
    p.endsWith('.wasm') ? path.join(dir, 'wgsl_analyzer.wasm') : p,
  printErr: (t) => console.log('  [stderr]', t),
  onAbort: (w) => console.error('  [ABORT]', w),
  onWgslAnalyzerReady: () => signalReady(),
})

// MEMFS starts empty and the vfs loader globs for wesl.toml, so without a
// manifest the server has no workspace and answers nothing. Tab files are not
// seeded: didOpen alone puts a file in the package (see wasm-lsp-multifile.md).
mod.FS.mkdirTree(WORKSPACE)
mod.FS.writeFile(`${WORKSPACE}/wesl.toml`, 'edition = "2026_pre"\nroot = "."\n')
mod.FS.chdir(WORKSPACE)
mod.callMain([])
await ready

const send = (o) =>
  mod.ccall('wa_push', 'number', ['string'], [JSON.stringify(o)])
const notify = (method, params) => send({ jsonrpc: '2.0', method, params })
const request = (method, params) => {
  const id = nextId++
  const settled = new Promise((resolve, reject) => {
    pending.set(id, resolve)
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`timeout waiting for ${method}`))
    }, 30_000)
  })
  send({ jsonrpc: '2.0', id, method, params })
  return settled
}

const uri = (name) => `file://${WORKSPACE}/${name}`

await request('initialize', {
  processId: null,
  rootUri: `file://${WORKSPACE}`,
  workspaceFolders: [{ uri: `file://${WORKSPACE}`, name: 'workspace' }],
  capabilities: {},
})
notify('initialized', {})

for (const [name, text] of [
  ['bindings.wesl', BINDINGS],
  ['main.wesl', MAIN],
]) {
  notify('textDocument/didOpen', {
    textDocument: { uri: uri(name), languageId: 'wesl', version: 1, text },
  })
}

// The workspace loads asynchronously after didOpen. Querying immediately gets
// null back for *everything*, which looks exactly like a broken build.
await new Promise((r) => setTimeout(r, 8000))

const results = []
const check = (ok, label, detail = '') => {
  results.push(ok)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail && ` -> ${detail}`}`)
}

const definition = await request('textDocument/definition', {
  textDocument: { uri: uri('main.wesl') },
  position: USE_OF_UNIFORMS,
})
const targets = []
const walk = (v) => {
  if (!v) return
  if (Array.isArray(v)) return v.forEach(walk)
  if (v.uri) targets.push(`${v.uri}:${v.range?.start?.line}`)
  if (v.targetUri) targets.push(`${v.targetUri}:${v.targetRange?.start?.line}`)
}
walk(definition.result)
check(
  targets.some((t) => t.startsWith(uri('bindings.wesl'))),
  'cross-file go-to-definition',
  targets.join(', ') || 'no result',
)

const completion = await request('textDocument/completion', {
  textDocument: { uri: uri('main.wesl') },
  position: AFTER_DOT,
})
const items = completion.result?.items ?? completion.result ?? []
check(items.length > 0, 'completion', `${items.length} item(s)`)

const diags = notes.filter(
  (n) => n?.method === 'textDocument/publishDiagnostics',
)
const errors = diags.flatMap((d) => d.params.diagnostics)
check(
  diags.length > 0,
  'diagnostics published',
  `${diags.length} notification(s)`,
)
check(
  errors.length === 0,
  'no diagnostics on valid source',
  errors.map((e) => e.message).join('; ') || 'clean',
)

const ok = results.every(Boolean)
console.log(ok ? '\nPASSED\n' : '\nFAILED\n')
process.exit(ok ? 0 : 1)
