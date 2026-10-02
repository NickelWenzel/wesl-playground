import * as monaco from 'monaco-editor'
import { WgslAnalyzerServer } from 'wgsl-analyzer-web'
import { WgslAnalyzerTransport } from './lsp_transport'

import bevy_wgsl from './packages/bevy_wgsl.json'
import lygia_wgsl from './packages/lygia_wgsl.json'

// workspace layout:
//   wesl.toml
//   shaders/<tab>.wesl              the tabs, i.e. `package::<tab>`
//   packages/<pkg>/wesl.toml
//   packages/<pkg>/<path>.wesl      `<pkg>::<path>`
const ROOT = '/workspace'

const PACKAGE_MANIFEST = 'edition = "2026_pre"\nroot = "."\n'

function workspaceFiles(): Record<string, string> {
  // the tabs are open documents, never files, but the server fails to load the
  // package if its root directory does not exist.
  const files: Record<string, string> = { 'shaders/.keep': '' }
  const packages = new Set<string>()
  for (const [module, source] of Object.entries({
    ...bevy_wgsl,
    ...lygia_wgsl,
  })) {
    const [pkg, ...path] = module.split('::')
    packages.add(pkg)
    files[`packages/${pkg}/${path.join('/')}.wesl`] = source
  }
  for (const pkg of packages) {
    files[`packages/${pkg}/wesl.toml`] = PACKAGE_MANIFEST
  }
  files['wesl.toml'] = [
    'edition = "2026_pre"',
    '',
    '[dependencies]',
    ...[...packages].map((pkg) => `${pkg} = { path = "packages/${pkg}" }`),
    '',
  ].join('\n')
  return files
}

let lspStarted = false

// one language server for every editor: the client syncs all monaco models.
export function startLsp() {
  if (lspStarted) return
  lspStarted = true
  WgslAnalyzerServer.start({
    root: ROOT,
    files: workspaceFiles(),
    onStderr: (line) => console.log(line),
    onExit: (code) => console.log(`wgsl_analyzer lsp exited with code ${code}`),
  })
    .then((server) => {
      const client = new monaco.lsp.MonacoLspClient(
        new WgslAnalyzerTransport(server),
      )
      console.log('initialized lsp', client)
    })
    .catch((e) => {
      console.error('failed to start wgsl_analyzer lsp', e)
    })
}

// files must be `.wesl`: in a `.wgsl` file, `import` is a syntax error.
const tabUri = (name: string) => monaco.Uri.file(`${ROOT}/shaders/${name}.wesl`)

const tabModels = new Map<string, monaco.editor.ITextModel>()

export const tabModel = (name: string) => tabModels.get(tabUri(name).toString())

/**
 * Keeps one model per tab, so that the language server sees every tab and
 * imports between them resolve. A tab whose name is already taken gets no model.
 */
export function syncTabModels(
  files: readonly { name: string; source: string }[],
) {
  const wanted = new Map<string, { uri: monaco.Uri; source: string }>()
  for (const { name, source } of files) {
    const uri = tabUri(name)
    if (!wanted.has(uri.toString())) wanted.set(uri.toString(), { uri, source })
  }

  for (const [key, model] of tabModels) {
    if (!wanted.has(key)) {
      model.dispose()
      tabModels.delete(key)
    }
  }

  for (const [key, { uri, source }] of wanted) {
    const model = tabModels.get(key)
    if (!model) {
      tabModels.set(key, monaco.editor.createModel(source, 'wgsl', uri))
    } else if (model.getValue() !== source) {
      model.setValue(source)
    }
  }
}
