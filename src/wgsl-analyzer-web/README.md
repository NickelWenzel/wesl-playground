# wgsl-analyzer-web

[`wgsl-analyzer`][wgsl-analyzer] built for `wasm32-unknown-emscripten`, running as the
playground's language server in a Web Worker. Committed so a fresh clone gets
go-to-definition, completion and diagnostics without a Rust or emscripten toolchain —
the same reason [`../wesl-web`](../wesl-web) ships a prebuilt wesl-rs.

Why it exists and how it is wired up: [`docs/wasm-lsp.md`](../../docs/wasm-lsp.md) and
[`docs/wasm-lsp-multifile.md`](../../docs/wasm-lsp-multifile.md).

| File | |
|---|---|
| `wgsl_analyzer.js` | emscripten glue, `MODULARIZE`d as `createWgslAnalyzer` |
| `wgsl_analyzer.wasm` | the server itself |

**These two files are never imported.** `vite.config.ts` serves them as opaque bytes at
`/wgsl-analyzer-web/`; letting Vite parse the glue aborts the build. They must also stay
siblings under those exact names, because the glue spawns its pthread workers with
`new Worker(new URL("wgsl_analyzer.js", import.meta.url))`.

## Building

Needs a nightly toolchain with `rust-src`, plus [emsdk][emsdk] and a checkout of
[`wgsl-analyzer`][wgsl-analyzer] as siblings of this repository (override with `WA_DIR` /
`EMSDK_DIR`):

```sh
rustup toolchain install nightly
rustup +nightly component add rust-src
script/buildWgslAnalyzerRelease.sh
```

`-Z build-std` is not optional: the shipped `rust-std` for this target is `singlethread:
true`, so `-pthread` has nothing to link against, and the server's `main_loop` needs real
threads.

The build is tuned for size — `opt-level=z`, fat LTO, one codegen unit, and emcc `-Oz` with
assertions off — which is roughly half of what a plain `--release` produces. All of those are
environment overrides in the script, so nothing in the analyzer's own manifests changes.

For prototype iteration use [`script/buildWgslAnalyzerWasm.sh`](../../script/buildWgslAnalyzerWasm.sh)
instead. It builds a debug analyzer into `public/wgsl-analyzer/` (gitignored), which is loaded
only when you ask for it:

```sh
VITE_WGSL_ANALYZER=debug npm run dev
```

Reach for that when you need emscripten's assertions: they are compiled out of the shipped
artifact, so browser failures there are far less legible. The variable is read when vite starts,
so switching modes means restarting the dev server.

Check a build with [`script/smokeWgslAnalyzer.mjs`](../../script/smokeWgslAnalyzer.mjs).

[wgsl-analyzer]: https://github.com/wgsl-analyzer/wgsl-analyzer
[emsdk]: https://emscripten.org/docs/getting_started/downloads.html
