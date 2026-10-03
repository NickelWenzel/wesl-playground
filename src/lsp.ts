import monaco, { setResourceOpener } from './monaco'
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
const TABS = `${ROOT}/shaders/`
const PACKAGES = `${ROOT}/packages/`

/** Absolute path of a bundled package module, e.g. `bevy::pbr::lighting`. */
export function packagePath(module: string) {
  return `${PACKAGES}${module.replaceAll('::', '/')}.wesl`
}

const PACKAGE_MANIFEST = 'edition = "2026_pre"\nroot = "."\n'

const packageSources: Record<string, string> = { ...bevy_wgsl, ...lygia_wgsl }

const moduleOfPackagePath = (path: string) =>
  path.slice(PACKAGES.length, -'.wesl'.length).replaceAll('/', '::')

function workspaceFiles(): Record<string, string> {
  // the tabs are open documents, never files, but the server fails to load the
  // package if its root directory does not exist.
  const files: Record<string, string> = { 'shaders/.keep': '' }
  const packages = new Set<string>()
  for (const [module, source] of Object.entries(packageSources)) {
    packages.add(module.split('::')[0])
    files[packagePath(module).slice(ROOT.length + 1)] = source
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
      // subscribed before the client, so that it runs first.
      server.onMessage(createPackageModels)
      const client = new monaco.lsp.MonacoLspClient(
        new WgslAnalyzerTransport(server),
      )
      console.log('initialized lsp', client)
    })
    .catch((e) => {
      console.error('failed to start wgsl_analyzer lsp', e)
    })
}

/**
 * The client only accepts locations in files that have a model, and throws
 * otherwise. This creates the package models a message points to before the
 * client sees it.
 */
function createPackageModels(message: unknown) {
  if (typeof message !== 'object' || message === null) return
  for (const [key, value] of Object.entries(message)) {
    if ((key === 'uri' || key === 'targetUri') && typeof value === 'string') {
      const path = monaco.Uri.parse(value).path
      if (path.startsWith(PACKAGES)) packageModel(moduleOfPackagePath(path))
    } else {
      createPackageModels(value)
    }
  }
}

/**
 * The model of a bundled package module, created on first use. Package sources
 * never change, so the models live as long as the page.
 */
export function packageModel(module: string) {
  const source = packageSources[module]
  if (source === undefined) return undefined
  const uri = monaco.Uri.file(packagePath(module))
  return (
    monaco.editor.getModel(uri) ??
    monaco.editor.createModel(source, 'wgsl', uri)
  )
}

// files must be `.wesl`: in a `.wgsl` file, `import` is a syntax error.
const tabUri = (name: string) => monaco.Uri.file(`${TABS}${name}.wesl`)

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

/**
 * Shows the target of a go-to-definition into another file: `openTab` or
 * `openPackage` must show it in an editor.
 */
export function setOpener(handlers: {
  openTab: (name: string) => void
  openPackage: (module: string) => void
}) {
  setResourceOpener((resource) => {
    const path = resource.path
    if (!path.endsWith('.wesl')) return false
    if (path.startsWith(TABS)) {
      handlers.openTab(path.slice(TABS.length, -'.wesl'.length))
    } else if (path.startsWith(PACKAGES)) {
      handlers.openPackage(moduleOfPackagePath(path))
    } else {
      return false
    }
    return true
  })
}
