// Hosts wgsl-analyzer (wasm32-unknown-emscripten, built with -pthread) and bridges
// it to the page's monaco-lsp-client transport.
//
// Message flow:
//   page --postMessage(obj)--> here --ccall wa_push--> crossbeam channel --> main_loop
//   main_loop --> channel --> Rust writer thread --> wa_emit (js-library,
//   __proxy:'async', so it runs on THIS thread) --> postMessage(obj) --> page
//
// Note we deliberately do NOT use emscripten's stdio: fd_read is in emscripten's
// proxiedFunctionTable, so a blocking stdin read from the server's reader thread
// would block this thread, which also services fd_write and deferred
// pthread_create. That deadlocks. See crates/wgsl-analyzer/src/bin/wasm_io.rs.

import { WORKSPACE_PATH, WORKSPACE_WESL_TOML } from './workspace'
import { vendorFiles } from './packages'

// Typed locally rather than via `/// <reference lib="webworker" />`, which would
// pull lib.webworker.d.ts into a project that already uses lib.dom.d.ts and make
// the two conflict globally.
type WorkerScope = {
  postMessage: (message: unknown) => void
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent) => void,
  ) => void
}
const ctx = self as unknown as WorkerScope

// Served from public/, so Vite never tries to transform the emscripten glue.
// The filename must stay `wgsl_analyzer.js`: the glue spawns its pthread workers
// with `new Worker(new URL("wgsl_analyzer.js", import.meta.url))`.
const GLUE_URL = '/wgsl-analyzer/wgsl_analyzer.js'
const WASM_URL = '/wgsl-analyzer/wgsl_analyzer.wasm'

type EmscriptenModule = {
  FS: {
    mkdirTree: (path: string) => void
    writeFile: (path: string, data: string | Uint8Array) => void
    chdir: (path: string) => void
  }
  callMain: (args: string[]) => void
  ccall: (
    name: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[],
  ) => unknown
}

let mod: EmscriptenModule | null = null
// Messages the page sends before the server is up. The LSP `initialize` request
// arrives almost immediately, well before a ~70 MB debug wasm has instantiated.
const pending: unknown[] = []

// Strings are ignored by the page's transport (it only dispatches objects),
// so they are safe to use for logging without being parsed as JSON-RPC.
const log = (text: string) => ctx.postMessage(`[wgsl-analyzer] ${text}`)

function push(message: unknown): void {
  if (mod === null) {
    pending.push(message)
    return
  }
  const code = mod.ccall(
    'wa_push',
    'number',
    ['string'],
    [JSON.stringify(message)],
  ) as number
  if (code !== 0) log(`wa_push rejected message (code ${code})`)
}

ctx.addEventListener('message', (event: MessageEvent) => {
  // The transport only ever sends objects; ignore anything else.
  if (typeof event.data !== 'object' || event.data === null) return
  push(event.data)
})

async function boot(): Promise<void> {
  // Template literal + @vite-ignore so Vite leaves the glue alone and it is
  // fetched at runtime from public/.
  const glue = await import(/* @vite-ignore */ `${GLUE_URL}`)
  const createWgslAnalyzer = glue.default as (
    options: Record<string, unknown>,
  ) => Promise<EmscriptenModule>

  // callMain() returns immediately (main() runs on another thread), so the server
  // is not ready to accept messages yet. Rust calls wa_ready() once it is.
  let signalReady: () => void
  const ready = new Promise<void>((resolve) => {
    signalReady = resolve
  })

  const instance = await createWgslAnalyzer({
    thisProgram: '/usr/bin/wgsl-analyzer',
    locateFile: (path: string, prefix: string) =>
      path.endsWith('.wasm') ? WASM_URL : `${prefix}${path}`,
    print: (text: string) => log(`stdout: ${text}`),
    printErr: (text: string) => log(`stderr: ${text}`),
    onAbort: (what: unknown) => log(`ABORT: ${String(what)}`),
    onWgslAnalyzerReady: () => signalReady(),
  })

  // The vfs loader walks the real filesystem looking for wesl.toml, and MEMFS
  // starts empty, so without this the server has no workspace and answers
  // nothing. Built with -sINVOKE_RUN=0 precisely so we can seed before main().
  //
  // The user's own tabs are deliberately NOT written here: textDocument/didOpen
  // is enough to make a file part of the package (measured), and didClose then
  // removes it again, which gives correct delete/rename semantics for free. Only
  // the manifests and the read-only bundled packages need to exist on disk,
  // because nothing ever opens those as documents.
  instance.FS.mkdirTree(WORKSPACE_PATH)
  instance.FS.writeFile(`${WORKSPACE_PATH}/wesl.toml`, WORKSPACE_WESL_TOML)

  const started = Date.now()
  for (const { path, source } of vendorFiles()) {
    instance.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')))
    instance.FS.writeFile(path, source)
  }
  log(`seeded bundled packages in ${Date.now() - started}ms`)

  instance.FS.chdir(WORKSPACE_PATH)

  // Runs run_server() on a pthread (PROXY_TO_PTHREAD), so it does not block us.
  instance.callMain([])
  await ready
  mod = instance

  log(`booted; flushing ${pending.length} queued message(s)`)
  const queued = pending.splice(0, pending.length)
  for (const message of queued) push(message)
}

boot().catch((error: unknown) => {
  log(`failed to boot: ${String(error)}`)
  console.error('[wgsl-analyzer] boot failed', error)
})
