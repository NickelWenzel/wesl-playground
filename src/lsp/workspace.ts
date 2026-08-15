// Shared between the LSP worker (which seeds emscripten's MEMFS) and the client
// (which builds Monaco model URIs and the LSP rootUri).
//
// These three must agree exactly — MEMFS path == Monaco model URI path == rootUri.
// The client also lowercases every URI it sends, so keep this lowercase.

export const WORKSPACE_PATH = '/workspace'
export const WORKSPACE_URI = `file://${WORKSPACE_PATH}`

export const WESL_TOML = `edition = "2026_pre"
root = "."
`
