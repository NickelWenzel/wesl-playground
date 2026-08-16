# Shipping the analyzer: a committed release build

Why `src/wgsl-analyzer-web/` exists and what it implies. Builds on
[`wasm-lsp.md`](./wasm-lsp.md) and [`wasm-lsp-multifile.md`](./wasm-lsp-multifile.md),
which cover getting the analyzer running and making imports resolve.

**Problem:** the language server only existed as a 67 MB debug build in `public/wgsl-analyzer/`
(gitignored). A fresh clone had no language server at all until someone installed nightly Rust,
`rust-src` and emsdk and ran a `-Z build-std` build — two toolchains and a ~2 minute build just
to open a playground.

**Result:** `git clone && npm install && npm run dev` gets go-to-definition, completion and
diagnostics. The artifacts are committed, mirroring `src/wesl-web/`, which already ships a
prebuilt 5.8 MB wesl-rs the same way.

---

## 1. Size

Every visitor downloads this, so the release build is tuned for bytes.

| | debug | plain `--release` | tuned |
|---|---|---|---|
| `wgsl_analyzer.wasm` | 67 MB | 8.74 MB | **4.85 MB** |
| `wgsl_analyzer.js` | 260 KB | 166 KB | **104 KB** |
| gzipped total | — | 2.59 MB | **1.65 MB** |
| build | — | 2m01s | ~2m30s |

The flags live in `script/buildWgslAnalyzerRelease.sh`, applied as environment overrides so
the analyzer's shared `Cargo.toml` and `.cargo/config.toml` are untouched and the debug
prototype build keeps its own settings. Contributions, measured one at a time:

| lever | wasm |
|---|---|
| plain `--release` | 9,165,817 |
| `EMCC_CFLAGS="-Oz -sASSERTIONS=0"` | 8,542,885 |
| `+ lto=fat`, `codegen-units=1` | ~6.1 MB |
| `+ opt-level=z` | **5,087,694** |

`EMCC_CFLAGS` is appended *after* the settings derived from the rustflags in
`.cargo/config.toml`, and for emscripten `-s` options the last occurrence wins — which is how
`-sASSERTIONS=0` overrides the `-sASSERTIONS=1` there without editing a shared file. `-Oz` is
also what shrinks the glue JS by a third.

`opt-level=z` and `lto=fat` are the big levers, worth ~3.5 MB between them. **`panic = unwind`
must not be touched** whatever else changes: salsa's cancellation is built on `catch_unwind`.
`opt-level` is the setting most likely to want revisiting, so all four cargo settings can be
overridden from the environment.

Git grows by ~1.7 MB per committed revision, not 4.85 — git zlib-compresses blobs — but wasm
does not delta-compress, so every rebuild adds another full copy. Rebuild deliberately.

### What it costs

Assertions are now off in the shipped build. They produced the actionable errors during
bring-up (`callMain not exported`, stack overflows), so when something goes wrong in the
browser, rebuild the debug prototype into `public/wgsl-analyzer/` and reproduce there.

`opt-level=z` costs no measured speed. Against the real 254-module bundled package tree, in
node, two runs each:

| | plain release | tuned |
|---|---|---|
| instantiate | 91–102 ms | 80–101 ms |
| seed 254 modules | 41–51 ms | 24–28 ms |
| first cross-file resolve | 156–163 ms | 147–157 ms |
| completion p50 / p90 | 2 / 3 ms | 2 / 4 ms |

The smaller module is *faster* to load, and analysis is a wash — p90 completion is the only
number that moved the wrong way, by 1 ms. Caveat: this workload is small. A much heavier
project could price `opt-level=z` differently, and that is when to try `s` or `3`.

### The megabyte that was left on the table, deliberately

`-Oz` at link time does **not** make emcc run `wasm-opt -Oz` over the module: a standalone pass
afterwards still finds ~1 MB (stripping accounts for none of it — the name section is already
gone). But that gain only appears with `--enable-gc`, and the result then fails to validate
without it:

```
[wasm-validator error in function 11146] call_ref requires gc [--enable-gc]
```

So wasm-opt rewrites indirect calls into `call_ref`, and the artifact would need a
WasmGC-capable runtime. With a feature set matching what the module actually uses, `-Oz` gains
nothing (8,551,356 vs emcc's 8,542,885). Hence **no post-pass.** Note the headless smoke test
runs on node, which *does* support WasmGC — it passes the broken-for-browsers artifact happily,
so this is not something the test would have caught.

## 2. Two homes; the release build is the default and the debug build is opt-in

```
src/wgsl-analyzer-web/   committed release build            -> /wgsl-analyzer-web/  (default)
public/wgsl-analyzer/    buildWgslAnalyzerWasm.sh, gitignored -> /wgsl-analyzer/    (opt-in)
```

The release build is what ships and what a clone gets. The debug build is loaded **only** when
asked for, at vite start:

```sh
VITE_WGSL_ANALYZER=debug npm run dev
```

`src/lsp/wgslAnalyzer.worker.ts` reads that through `import.meta.env`, so the choice is fixed at
compile time and the unused branch disappears. Verified in all four combinations — the built
worker chunk contains only `"/wgsl-analyzer-web"` by default and only `"/wgsl-analyzer"` with the
variable set. In dev, vite inlines the env object at the top of the worker module
(`import.meta.env = {…,"VITE_WGSL_ANALYZER":"debug"}`), so it resolves inside a worker too.

**The build prunes a debug build it was not asked to ship.** Vite copies `publicDir` verbatim, so
a developer who has run the prototype script would otherwise get both in `dist/` — 97 MB, of
which 67 MB is dead weight nothing loads. `writeBundle` removes `dist/wgsl-analyzer` unless
`VITE_WGSL_ANALYZER=debug`, with a warning when it does. Default builds are 26 MB.

> **Why this is an explicit switch and not "use the debug build if it is there".**
> The obvious auto-detect is a `HEAD` request for the override. It does not work: vite's
> `appType` defaults to `'spa'`, so a request for a file that does *not* exist falls through
> `htmlFallbackMiddleware` to `indexHtmlMiddleware` and returns **200 `text/html`**. Measured,
> with `public/wgsl-analyzer/` removed:
>
> | probe | result |
> |---|---|
> | `HEAD`, `Accept: */*` | `200 text/html` — reports present, wrongly |
> | `HEAD`, `Accept: application/wasm` | `404` — correct |
>
> An `Accept` header plus a content-type assertion does fix it (the html fallback is skipped only
> when `Accept` is neither `*/*` nor `text/html`), and the same trap applies to `vite preview`
> and any SPA-fallback host. But it buys a runtime round-trip and a silent, implicit mode switch
> — a stale prototype build quietly replacing the one you are testing. The env var is cheaper and
> says what it does.

## 3. The glue must never enter Vite's module graph

This rules out every approach where Rollup parses `wgsl_analyzer.js`, including a plain import.
The glue self-spawns its pthread workers with

```js
new Worker(new URL("wgsl_analyzer.js", import.meta.url), {
  "type": "module", "workerData": "em-pthread", "name": "em-pthread-" + PThread.nextWorkerID
})
```

and `vite:worker-import-meta-url` matches that pattern, then `eval`s the options object to
decide the worker type. The object is not static, so it throws
`Vite is unable to parse the worker options as the value is not static` — a 500 in dev, an
aborted build in production. Deterministic, not environment-dependent.

**`?url` does not help**, though its first half looks right: `vite:asset` returns
`export default "<url>"`, so the content bypasses the transform pipeline. But in dev the URL it
hands back is under `/src/`, and fetching *that* re-enters `transformMiddleware`, which matches
it as a JS request and runs the full plugin pipeline — the same throw. It gives you the URL of a
file you cannot then fetch.

So a ~50-line inline plugin in `vite.config.ts` (no new dependency) serves the files as opaque
bytes at a fixed prefix:

- **dev** — a middleware registered *synchronously inside* `configureServer`. That ordering is
  load-bearing: `configureServer` hooks are awaited before Vite pushes any of its own
  middleware, while a *returned* hook runs after transform and static. Being first also puts it
  ahead of Vite's host and CORS checks, so the route serves only the two known filenames and
  nothing else in the directory. It sends an `ETag` and honours `If-None-Match`, or every reload
  re-transfers 8.8 MB.
- **build** — `fs.copyFileSync` in `writeBundle`. `emitFile` with an explicit `fileName` would
  also bypass hashing, but it parks the whole artifact in the bundle object until write.
  `writeBundle` is never invoked for the `?worker` sub-bundle (that path calls
  `bundle.generate()`, not `write()`), so no double-emit guard is needed.

**The dynamic import's shape is load-bearing too.** `@vite-ignore` on its own only suppresses the
warning; `vite:import-analysis` still rewrites the specifier unless it looks like a plain string
JS request. `` import(`${base}/wgsl_analyzer.js`) `` survives; a bare identifier gets `?import`
appended, which routes it into `transformMiddleware` and throws. Keep it a template literal
ending in a literal `.js`.

**The sibling-filename invariant** from `wasm-lsp.md` applies wherever the files are served:
`wgsl_analyzer.js` and `wgsl_analyzer.wasm` must sit at the same directory URL under exactly
those names, or every pthread 404s. `Module.mainScriptUrlOrBlob`, the usual bundler escape
hatch, is in `ignoredModuleProp` for `EXPORT_ES6` builds.

## 4. Verification

Release and debug were run through the same headless harness — the real wasm server, `wa_push`
in and `postMessage` out, no browser — and answered **identically**:

| check | release | debug |
|---|---|---|
| cross-file goto-def (`uniforms` → `bindings.wesl:4`) | ✓ | ✓ |
| completion | 172 items | 172 items |
| diagnostics published, no false errors | ✓ | ✓ |

Diagnostic worth keeping: the server loads the workspace *asynchronously* after `didOpen`.
Querying immediately returns `null` for everything — goto-def, completion and diagnostics alike —
which looks exactly like a broken build. Let it settle before asserting anything.

Also checked: glue byte-identical to the cargo output (only renamed) and to what `dist/` emits;
emitted unhashed at the exact path; `README.md` not shipped; path traversal through the dev route
contained; `ETag` → `304`; `vite preview` serves both files with the right content types under
COOP/COEP; `npm run typecheck` and `npm run build` clean.

**Not covered:** no browser ran. The pthread workers actually spawning from `/wgsl-analyzer-web/`,
and the editor integration, are unverified by this pass.

## 5. Known limits

- **The analyzer checkout is still unpinned.** The build needs `../wgsl-analyzer` at or after
  `6e151e0` and `../emsdk` as siblings (`WA_DIR` / `EMSDK_DIR` override). Nothing in this repo
  records or fetches that revision, so the committed artifact is the only reproducible thing
  about it.
- **Production COOP/COEP is still unsolved** — see `wasm-lsp.md` §4. There is no
  `public/_headers`, and without cross-origin isolation the threaded wasm cannot start at all.
  Shipping the artifact does not ship a working deployment.
- The debug build is selected at vite start, so switching between the two means restarting the
  dev server. That is the price of not probing at runtime; see §2.

## Files

| Path | Role |
|---|---|
| `src/wgsl-analyzer-web/` | the committed release artifacts, plus a rebuild README |
| `script/buildWgslAnalyzerRelease.sh` | release build → `src/wgsl-analyzer-web/` |
| `vite.config.ts` | `wgslAnalyzerWeb()` — serves in dev, copies on build |
| `src/lsp/wgslAnalyzer.worker.ts` | picks release vs debug build, loads the glue |
| `src/vite-env.d.ts` | types `VITE_WGSL_ANALYZER` |
| `tsconfig.node.json` | typechecks `vite.config.ts` against node, away from browser code |
