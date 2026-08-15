# In-browser LSP: wgsl-analyzer as wasm

Why the LSP-related changes exist, and what they imply.

**Goal:** replace the remote language server at `wgsl-analyzer.thissma.fr:443` (hardcoded in
`Editor.tsx` before this change) with wgsl-analyzer compiled to
`wasm32-unknown-emscripten`, running in a Web Worker. No backend, works offline.

**Status:** go-to-definition, completion (171 items), incremental sync and diagnostics all
work. Hover returns nothing — it is an unimplemented stub in wgsl-analyzer itself
(<https://github.com/wgsl-analyzer/wgsl-analyzer/issues/362>), not a bug here.

The server-side reasoning (threads, `-Zbuild-std`, transport) lives in the analyzer repo:
`wgsl-analyzer/docs/wasm-browser-lsp.md`. Multi-file support and cross-file navigation are
covered in [`wasm-lsp-multifile.md`](./wasm-lsp-multifile.md).

---

## 1. Fixing what `f04e2ad` left broken

Commit `f04e2ad` ("monaco-lsp-client, mk.1") vendored Hediet's
[monaco-lsp-client](https://github.com/hediet/monaco-lsp-client) into
`src/monaco-lsp-client/` but the wiring never ran:

| Problem | Fix |
|---|---|
| `index.js:1` imports `monaco-editor-core`, which is not a dependency and has no alias — the module cannot resolve | `resolve.alias` in `vite.config.ts` maps it to `monaco-editor` |
| `Editor.tsx` called `monaco.lsp.*`, but `monaco.ts` had the `lsp` re-export commented out → `TypeError` on every editor mount, outside the `.catch` | Removed; the client is now `src/lsp/client.ts` |
| A client was constructed **per `<Editor>` mount**, and there are three | `src/lsp/client.ts` is a module-level singleton — monaco provider registration is global |
| Stray `debugger` statement at `index.js:4021` | Removed |

## 2. Vendored-client patches

These are edits to `src/monaco-lsp-client/`, marked `PLAYGROUND PATCH`. Each is required:

- **`rootUri` was hardcoded `null`.** wgsl-analyzer discovers its workspace by globbing for
  `wesl.toml` from `rootUri`; with `null` it finds nothing and answers no requests. The
  constructor now takes `{ rootUri }`.
- **`_getOrCreateManagedModel` synced *every* model on the page** — no language filter. That
  meant the compiler-output pane and the read-only package previews (URIs containing `::`)
  were opened as workspace source files. Now only `wgsl` models sync; read-only panes use a
  separate `wgsl-readonly` language id registered in `monaco.ts`.

## 3. The URI invariant

Three things must agree exactly, or the server silently resolves nothing:

```
emscripten MEMFS path  ==  monaco model URI path  ==  LSP rootUri
        /workspace          file:///workspace/…        file:///workspace
```

`src/lsp/workspace.ts` is the single source of truth. Two consequences:

- `Editor.tsx` builds model URIs as `file:///workspace/<name>` (previously `file:///<name>`).
- Keep paths **lowercase** — the vendored client lowercases every URI it sends
  (`uri.toString(true).toLowerCase()`).

MEMFS starts empty, so the worker seeds `/workspace/wesl.toml` before `callMain()`; without
it the analyzer has no workspace. This mirrors the
[clangd example](https://github.com/TypeFox/monaco-languageclient/tree/main/packages/examples/src/clangd)
that the worker's structure is based on (itself derived from
[clangd-in-browser](https://github.com/guyutongxue/clangd-in-browser)).

> We reuse only the clangd example's *worker-side* approach — asset loading, FS seeding,
> `callMain` ordering. Its client side is built on `monaco-languageclient` +
> `@codingame/monaco-vscode-*`, which this project does not depend on.

## 4. Cross-origin isolation is mandatory

The wasm is built with `-pthread`, so it needs `SharedArrayBuffer`, which needs a
cross-origin-isolated context. `vite.config.ts` sets on both `server` and `preview`:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`src/lsp/client.ts` checks `crossOriginIsolated` and logs a clear error rather than letting
it surface as an opaque wasm instantiation failure.

**Implication for deployment:** the `deploy` script targets Cloudflare Pages, and there is no
`public/_headers` yet. Production will need one (or a `mini-coi`-style service-worker shim,
as the clangd example uses for GitHub Pages) before this ships.

> <https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated>

## 5. Why the artifacts live in `public/`

`script/buildWgslAnalyzerWasm.sh` copies the build into `public/wgsl-analyzer/` (gitignored).

- The emscripten glue must **not** go through Vite's transforms, so the worker loads it with
  a runtime `import(/* @vite-ignore */ …)`.
- The artifact is ~67 MB in debug (~10-20 MB expected with `--release`) — too large for git,
  despite the precedent set by the committed 5.8 MB `src/wesl-web/wesl_web_bg.wasm`.
- **The filename must stay `wgsl_analyzer.js`.** The glue spawns its pthread workers with
  `new Worker(new URL("wgsl_analyzer.js", import.meta.url))` — emcc's output name. Cargo
  renames the file to the bin name (`wgsl-analyzer.js`), so the script renames it back;
  otherwise every pthread 404s.

`worker.format: 'es'` is set because the worker uses top-level `import`.

## 6. Known rough edges

- `npm install` needs `--legacy-peer-deps`. Pre-existing and unrelated:
  `vite-plugin-monaco-editor` peer-requires `monaco-editor >=0.33.0`, and the pinned
  `0.55.0-dev-20251018` prerelease does not satisfy a plain semver range. That plugin is
  declared but never used in `vite.config.ts` — removing it would be the real fix.
- Diagnostics from the LSP use marker owner `lsp`; wesl-rs keeps using `wesl`. They coexist.

Two limits described here were lifted by the follow-up in
[`wasm-lsp-multifile.md`](./wasm-lsp-multifile.md): tab switching now swaps models rather than
contents, so the server sees a real multi-file workspace, and the bundled `bevy`/`lygia`
sources are seeded so their imports resolve.

## Files

| Path | Role |
|---|---|
| `src/lsp/wgslAnalyzer.worker.ts` | loads glue, seeds MEMFS, `callMain`, bridges postMessage ↔ `wa_push`/`wa_emit` |
| `src/lsp/client.ts` | singleton `MonacoLspClient`, isolation check |
| `src/lsp/workspace.ts` | the shared path/URI constants |
| `script/buildWgslAnalyzerWasm.sh` | builds the analyzer and copies artifacts |
| `vite.config.ts` | alias, COOP/COEP, ES workers |
