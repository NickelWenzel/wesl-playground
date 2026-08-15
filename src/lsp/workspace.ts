// Shared between the LSP worker (which seeds emscripten's MEMFS) and the page
// (which builds Monaco model URIs and the LSP workspace folders).
//
// The invariant that makes any of this resolve: for a given file, the MEMFS path,
// the Monaco model URI path, and the path the analyzer computes from the package
// root must be byte-identical. `FileSet::file_for_path` is an exact hash lookup —
// no normalisation, no case folding.

export const WORKSPACE_PATH = '/workspace'
export const WORKSPACE_URI = `file://${WORKSPACE_PATH}`

// Bundled read-only packages live outside the user's package so their files are
// not part of `package::`. Each gets its own manifest and source root.
export const VENDOR_PATH = '/vendor'
export const VENDOR_URI = `file://${VENDOR_PATH}`

/**
 * Dependency names, which are also the first path segment of the bundled JSON
 * keys (`bevy::pbr::…`, `lygia::color::…`) and therefore what users write in
 * `import`. Package names may not contain `-`, or the manifest fails to load.
 */
export const VENDOR_PACKAGES = ['bevy', 'lygia'] as const

// `edition` is required and "2026_pre" is the only accepted value. `root = "."`
// makes the package root the manifest's own directory (VfsPath::join normalises
// the "." away). Only the `{ path = … }` dependency form is implemented — the
// registry forms hit a todo!() and panic the server.
export const WORKSPACE_WESL_TOML = `edition = "2026_pre"
root = "."

[dependencies]
${VENDOR_PACKAGES.map((name) => `${name} = { path = "${VENDOR_PATH}/${name}" }`).join('\n')}
`

export const VENDOR_WESL_TOML = `edition = "2026_pre"
root = "."
`

/**
 * Tab name -> file name stem. Tab names are unvalidated (spaces, `::`, `/` and
 * duplicates are all reachable from the rename UI), but a name has to survive
 * being a path segment *and* a WESL identifier for `import package::<stem>` to
 * work. Anything outside `[A-Za-z0-9_]` becomes `_`, and a leading digit is
 * prefixed, since identifiers cannot start with one.
 */
export function stemForName(name: string): string {
  const stem = name.replace(/[^A-Za-z0-9_]/g, '_')
  return /^[0-9]/.test(stem) ? `_${stem}` : stem
}

// Everything is written as .wesl: a .wgsl file is Edition::DEFAULT, in which
// `import` and `::` paths are syntax errors.
export const pathForName = (name: string) =>
  `${WORKSPACE_PATH}/${stemForName(name)}.wesl`

export const uriForName = (name: string) => `file://${pathForName(name)}`

/**
 * Inverse of the vendor layout in packages.ts: turns a file under /vendor back
 * into the `::` module path users write in imports, which is also the key the
 * package explorer lists. Returns undefined for anything outside /vendor.
 */
export function moduleForVendorPath(path: string): string | undefined {
  const prefix = `${VENDOR_PATH}/`
  if (!path.startsWith(prefix) || !path.endsWith('.wesl')) return undefined

  const segments = path.slice(prefix.length, -'.wesl'.length).split('/')
  // `<pkg>/package.wesl` is the package's root module, written as just `<pkg>`.
  if (segments.length > 1 && segments[segments.length - 1] === 'package') {
    segments.pop()
  }
  return segments.join('::')
}

export interface ResolvedFile {
  /** the tab name, as shown in the UI */
  name: string
  /** absolute MEMFS path, also the model URI path */
  path: string
  source: string
}

/**
 * Maps tabs to workspace files, dropping any whose sanitised stem collides with
 * an earlier one — two files at one path would otherwise silently shadow each
 * other in the analyzer's FileSet.
 */
export function resolveFiles(
  files: readonly { name: string; source: string }[],
): { resolved: ResolvedFile[]; collisions: string[] } {
  const resolved: ResolvedFile[] = []
  const collisions: string[] = []
  const seen = new Map<string, string>()

  for (const { name, source } of files) {
    // An empty stem would produce "/workspace/.wesl", which Rust reads as a
    // hidden file with no extension and rejects outright.
    if (stemForName(name) === '') {
      collisions.push(`${JSON.stringify(name)} (not a usable file name)`)
      continue
    }
    const path = pathForName(name)
    const owner = seen.get(path)
    if (owner !== undefined) {
      collisions.push(`${name} (collides with ${owner} at ${path})`)
      continue
    }
    seen.set(path, name)
    resolved.push({ name, path, source })
  }
  return { resolved, collisions }
}
