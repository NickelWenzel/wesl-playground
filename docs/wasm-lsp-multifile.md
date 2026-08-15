# Multi-file WESL: making imports resolve across tabs

Why the multi-file LSP changes exist and what they imply. Builds on
[`wasm-lsp.md`](./wasm-lsp.md), which covers getting the analyzer running at all.

**Problem:** the LSP worked for exactly one file. `Editor.tsx` kept a single monaco model
and swapped its *contents* on tab switch, so the server only ever saw one document, and
`main`'s `import package::bindings::uniforms;` could never resolve. That import is in the
playground's default project (`storage.ts:64-128`), so the very first thing a user sees was
broken for the language server while both compilers handled it fine.

**Result:** cross-file go-to-definition, imported symbols in completion, and definitions that
land in the bundled `bevy`/`lygia` packages all work.

---

## 1. Tab files are never written to disk

The obvious design — mirror every tab into the analyzer's emscripten MEMFS and keep it in
sync — turned out to be unnecessary. Measured against the real server before writing any app
code:

- `textDocument/didOpen` **alone** puts a file in the package. Cross-file goto-def resolves
  with `/workspace` containing only `wesl.toml`.
- `textDocument/didClose` **removes** the module again. After closing `mandelbrot.wesl`,
  goto-def returns null; reopening at a new path resolves there.

So model lifecycle *is* file lifecycle: create model = create file, dispose = delete, and
rename is just close-then-open. That deleted an entire subsystem from the design — a worker
FS command channel, a seed handshake before `callMain`, and synthesized
`workspace/didChangeWatchedFiles` notifications — along with the zombie-module failure mode
those would have introduced (`didClose` re-reads from disk, so a stale MEMFS copy would
resurrect a renamed-away file).

`src/lsp/models.ts` owns one model per tab. Two consequences worth knowing:

- **Models are created for every tab up front, not lazily on first visit.** An unopened file
  is invisible to the analyzer, so `main` could not import `bindings` until you had clicked
  `bindings`. Diagnostics are likewise only computed for open documents.
- **Rename loses that tab's undo history**, because the name is the file identity.

`reconcile()` (`models.ts:94`) diffs the desired file set against the live models, so all four
mutation paths — new, delete, rename, and the shared-URL load that replaces the whole array —
are handled in one place. It is a no-op when only content changed, so typing does not churn
models.

## 2. Everything must be `.wesl`

Not cosmetic. A `.wgsl` file is `Edition::DEFAULT`, in which `import` and `::` paths are
*syntax errors*
([`base_db/src/editioned_file_id.rs`](https://github.com/wgsl-analyzer/wgsl-analyzer/blob/main/crates/base_db/src/editioned_file_id.rs)).
Tab `main` therefore maps to `/workspace/main.wesl`.

The mapping lives entirely in the LSP layer (`workspace.ts:46`), so `state.ts`, the rename UI,
share links and the localStorage schema are untouched. Module resolution is a flat layout:
the analyzer joins path segments with `/`, appends `.wesl`, and does an **exact** hash lookup
(`crates/hir_def/src/name_resolution.rs`), so `/workspace/bindings.wesl` is `package::bindings`
and `import package::bindings::uniforms` finds the item inside it.

Tab names are unvalidated (spaces, `::`, duplicates all reachable from the rename UI), so
`stemForName` restricts them to `[A-Za-z0-9_]` and `resolveFiles` (`workspace.ts:88`) drops
any tab whose stem collides with an earlier one, with a console warning — two tabs at one path
would otherwise silently shadow each other in the analyzer's file set.

## 3. Bundled packages are seeded once, before `callMain`

`bevy`/`lygia` are read-only and never opened as documents, so they *do* need to exist on
disk. `packages.ts` explodes the flat `Record<modulePath, source>` JSONs into
`/vendor/<pkg>/<segments>.wesl` — the inverse of what `script/weslPkgToJson.js` does when
generating them.

Measured cost: **254 files in 44ms**, against a 67 MB wasm. That is why this is eager rather
than lazily materialised on first import; lazy would have required a manifest rewrite and a
package re-discovery cycle mid-session for no measurable gain.

Constraints that shape the layout, all from the analyzer:

- Only `{ path = "…" }` dependencies parse. `{ package = "…" }` and the bare form reach a
  `todo!()` and **panic the server**.
- Each dependency directory needs its own `wesl.toml` with `edition = "2026_pre"` and an
  existing `root`.
- The dependency name is the `[dependencies]` key and cannot contain `-`. The JSON keys are
  prefixed `bevy::`/`lygia::`, so those are the names — not `bevy_wgsl`.
- `initialize` sends `workspaceFolders` for both `/workspace` and `/vendor`, since package
  discovery is gated on workspace membership.

## 4. Cross-file navigation needed two client-side fixes

The server returned correct targets from the start; nothing happened in the editor.

**A standalone monaco editor only ever displays the model it was given.** When go-to-definition
lands in a different document, monaco asks registered openers to handle it, and with none
registered the chain returns `null` and it silently does nothing
([`standaloneEditor.js:396-399`](https://github.com/microsoft/monaco-editor)). `models.ts:136`
registers `monaco.editor.registerEditorOpener`, which maps the target URI back to a tab,
activates it, and reveals the range. Diagnostic worth remembering: *peek* definition (Alt+F12)
worked even before this fix, because peek renders inline and never opens another editor.

**Definitions into unopened files threw.** The vendored client resolved every target URI
through `translateBackRange`, which throws `No text model for uri`
(`monaco-lsp-client/index.js:4540`) when the document has no model — the normal case for a
bundled package, which exists only on the analyzer's virtual disk. One throw rejected the
whole request, including valid results alongside it. Location conversion now does the range
arithmetic directly and falls back to a plain `Uri` (`index.js:2164`).

Targets under `/vendor` have no tab and are not editable, so they open read-only in the
Packages pane: `moduleForVendorPath` (`workspace.ts:63`) maps the path back to its `::` module
path and `PackageExplorer.showPackageModule` selects it and scrolls to the line. The handler is
injected rather than imported, because `PackageExplorer → Editor → models.ts` would otherwise
be an import cycle.

## 5. URI hygiene

- **Removed all four `.toLowerCase()` calls** in the vendored client. They made `Main` reach
  the server as `main` and let two differently-cased tabs collide on one document. The
  analyzer emits URIs unencoded and case-exact, and stems are restricted to `[A-Za-z0-9_]`, so
  the raw form round-trips. All four must agree or the reverse lookup misses.
- **Read-only panes moved to a `pkg://` scheme.** Previously the compiler output sat at
  `file:///workspace/output.wgsl` — inside the source root — and package previews at
  `file:///workspace/bevy::pbr::mesh`. They were excluded from sync only by their language id,
  but `getModel(uri)` reuses a model regardless of language, so a preview created first could
  hand a tab a never-synced model. Built with `Uri.from` rather than `Uri.parse`, since module
  paths contain `::`.
- **`<Show>` in `PackageExplorer` is now `keyed`.** It was unkeyed, so `FilePreview` was
  created once and only its prop mutated: the editor model kept the *first* previewed file's
  URI forever while displaying later files' text. Harmless before, wrong once navigation
  targets a specific module.

## 6. Verification

Headless, against the real wasm server (`wa_push` in / `postMessage` out, no browser) —
the same harness style as the previous pass:

| check | result |
|---|---|
| goto-def across tabs | `main` → `mandelbrot.wesl` |
| goto-def to an imported binding | → `bindings.wesl` |
| goto-def into a bundled package | → `/vendor/lygia/version.wesl` |
| imported symbol in unqualified completion | `uniforms` present |
| rename (close + open) | resolves at new path, old path gone |
| delete (close) | stops resolving |
| MEMFS after all of it | only `wesl.toml` |
| all 254 vendor modules, `module → path → module` | round-trips |

**Not covered:** the monaco/Solid layer — the reconciler, `setModel()` on tab switch, view
state restore, and the packages-pane routing — has no browser to run in. Typecheck and
production build pass; the click-through is unverified.

## 7. Known limits

- **Hover and qualified-path completion still return nothing.** Both are upstream stubs
  ([#362](https://github.com/wgsl-analyzer/wgsl-analyzer/issues/362),
  [#1323](https://github.com/wgsl-analyzer/wgsl-analyzer/issues/1323)) and no workspace
  plumbing turns them on. Completion after `package::bindings::` is empty; the imported
  symbol does appear in the *unqualified* list.
- **The package JSONs are now bundled twice** — once in the main chunk, once in the worker —
  adding ~575 KB. Fixable by fetching them at runtime; left alone as it is dwarfed by the wasm.
- **Flat layout only.** No nested modules or directory tabs, and no `package.wesl` root-module
  items.
- **Re-exports do not work** upstream: importing an item that the target file itself imported
  fails.

## Files

| Path | Role |
|---|---|
| `src/lsp/models.ts` | owns one model per tab; reconciler; editor-opener for cross-file navigation |
| `src/lsp/packages.ts` | explodes the bundled JSONs into a `/vendor` tree |
| `src/lsp/workspace.ts` | path/URI mapping, name sanitising, manifests |
| `src/lsp/wgslAnalyzer.worker.ts` | seeds manifests + packages before `callMain` |
| `src/Editor.tsx` | viewport only: swaps models, no longer owns them |
| `src/PackageExplorer.tsx` | `showPackageModule` entry point for package targets |
| `src/monaco-lsp-client/index.js` | location conversion, URI casing, `workspaceFolders` |
