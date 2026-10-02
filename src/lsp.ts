import * as monaco from 'monaco-editor'
import { WgslAnalyzerServer } from 'wgsl-analyzer-web'
import { WgslAnalyzerTransport } from './lsp_transport'

const ROOT = '/workspace'

// tabs live directly in the workspace, not in the default root `./shaders`.
const MANIFEST = 'edition = "2026_pre"\nroot = "."\n'

let lspStarted = false

// one language server for every editor: the client syncs all monaco models.
export function startLsp() {
  if (lspStarted) return
  lspStarted = true
  WgslAnalyzerServer.start({
    root: ROOT,
    files: { 'wesl.toml': MANIFEST },
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
const tabUri = (name: string) => monaco.Uri.file(`${ROOT}/${name}.wesl`)

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
