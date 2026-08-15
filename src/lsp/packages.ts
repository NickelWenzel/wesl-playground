// Turns the bundled flat package JSONs into a MEMFS tree the analyzer can resolve.
//
// The JSONs are `Record<modulePath, source>` with `::`-joined keys
// (`bevy::pbr::lighting`), which is the inverse of what the analyzer wants:
// `resolve_module` joins path segments with `/` and appends `.wesl`, then does an
// exact lookup. So `bevy::pbr::lighting` has to exist on disk as
// `/vendor/bevy/pbr/lighting.wesl`. This is the same mapping script/weslPkgToJson.js
// performs in reverse when generating these files.

import bevy_wgsl from '../packages/bevy_wgsl.json'
import lygia_wgsl from '../packages/lygia_wgsl.json'

import {
  VENDOR_PACKAGES,
  VENDOR_PATH,
  VENDOR_WESL_TOML,
  stemForName,
} from './workspace'

const SOURCES: Record<string, Record<string, string>> = {
  bevy: bevy_wgsl,
  lygia: lygia_wgsl,
}

export interface SeedFile {
  path: string
  source: string
}

/**
 * All files needed to make the bundled packages resolvable: one manifest per
 * package plus every module exploded to its own path. Modules whose key does not
 * start with the expected package prefix are skipped.
 */
export function vendorFiles(): SeedFile[] {
  const out: SeedFile[] = []

  for (const pkg of VENDOR_PACKAGES) {
    out.push({
      path: `${VENDOR_PATH}/${pkg}/wesl.toml`,
      source: VENDOR_WESL_TOML,
    })

    for (const [modulePath, source] of Object.entries(SOURCES[pkg] ?? {})) {
      const segments = modulePath.split('::')
      if (segments.shift() !== pkg) continue

      // A bare `<pkg>` key would be the package root module, which must be
      // named package.wesl — resolve_module has no .wgsl fallback for it.
      const relative =
        segments.length === 0
          ? 'package'
          : segments.map(stemForName).join('/')

      out.push({
        path: `${VENDOR_PATH}/${pkg}/${relative}.wesl`,
        source,
      })
    }
  }
  return out
}
