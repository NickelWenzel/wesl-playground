#!/usr/bin/env bash
# Builds the *release* wgsl-analyzer that ships with the playground, into
# src/wgsl-analyzer-web/. Those artifacts are committed, so that a fresh clone
# has a working language server without nightly Rust, rust-src and emsdk --
# mirroring src/wesl-web/, which ships wesl-rs the same way.
#
# For prototype iteration use script/buildWgslAnalyzerWasm.sh instead: it builds
# into public/wgsl-analyzer/ (gitignored), which the worker prefers over the
# bundled copy when present.
#
#   usage: script/buildWgslAnalyzerRelease.sh
set -euo pipefail

WA_DIR="${WA_DIR:-$(cd "$(dirname "$0")/../../wgsl-analyzer" && pwd)}"
EMSDK_DIR="${EMSDK_DIR:-$(cd "$(dirname "$0")/../../emsdk" && pwd)}"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/src/wgsl-analyzer-web"

echo "wgsl-analyzer: $WA_DIR"
echo "emsdk:         $EMSDK_DIR"
echo "out:           $OUT_DIR"

# emcc is not on PATH by default.
# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1

cd "$WA_DIR"

# ---------------------------------------------------------------------------
# Size. This artifact is committed and downloaded by every visitor, so the
# release build is tuned for bytes. Measured effect of each of these, in order:
#
#   plain --release                                    9.17 MB
#   + EMCC_CFLAGS below                                8.54 MB   (js 170K -> 106K)
#   + LTO / one codegen unit                           see docs/wasm-lsp-release.md
#   + opt-level=z
#
# EMCC_CFLAGS is appended *after* the settings derived from the rustflags in
# .cargo/config.toml, and for emscripten `-s` options the last occurrence wins.
# So this overrides -sASSERTIONS=1 for the shipped build without editing the
# shared config -- the debug prototype build keeps its assertions.
#
# -Oz also minifies the emscripten glue. Note it does NOT make emcc run
# `wasm-opt -Oz` over the module (measured: a standalone pass afterwards still
# finds ~1 MB) -- but taking that extra MB requires --enable-gc, which makes
# wasm-opt emit `call_ref` and so demands a WasmGC-capable runtime. Not worth
# narrowing the browser support of a playground, so there is no post-pass.
export EMCC_CFLAGS="${EMCC_CFLAGS:-} -Oz -sASSERTIONS=0"

# Applied as env rather than in the analyzer's Cargo.toml, which is shared with
# the native build. `panic = unwind` must NOT be overridden: salsa's
# cancellation is built on catch_unwind.
#
# opt-level=z measured no slower than 3 on this workload -- see
# docs/wasm-lsp-release.md -- but it is the setting most likely to want
# revisiting, so all four can be overridden from the environment.
export CARGO_PROFILE_RELEASE_OPT_LEVEL="${CARGO_PROFILE_RELEASE_OPT_LEVEL:-z}"
export CARGO_PROFILE_RELEASE_LTO="${CARGO_PROFILE_RELEASE_LTO:-fat}"
export CARGO_PROFILE_RELEASE_CODEGEN_UNITS="${CARGO_PROFILE_RELEASE_CODEGEN_UNITS:-1}"
export CARGO_PROFILE_RELEASE_INCREMENTAL="${CARGO_PROFILE_RELEASE_INCREMENTAL:-false}"
# ---------------------------------------------------------------------------

# Threads require rebuilding std with the wasm `atomics` feature: the shipped
# rust-std for wasm32-unknown-emscripten is `singlethread: true`, so -pthread
# cannot link against it. Hence nightly + -Z build-std.
cargo +nightly build \
  -Z build-std=std,panic_unwind \
  --package wgsl-analyzer --bin wgsl-analyzer \
  --target wasm32-unknown-emscripten \
  --release

BUILD_DIR="$WA_DIR/target/wasm32-unknown-emscripten/release"
mkdir -p "$OUT_DIR"
# emscripten 6 does not emit a separate .worker.js -- pthread workers re-run the
# main glue -- so these two files are the whole payload.
#
# The glue spawns pthread workers via `new Worker(new URL("wgsl_analyzer.js",
# import.meta.url))`, i.e. emcc's own output name (the crate name, underscored).
# Cargo renames that file to the *bin* name (hyphenated) in target/, so we must
# rename it back or every pthread fails with MODULE_NOT_FOUND / 404.
cp "$BUILD_DIR/wgsl-analyzer.js" "$OUT_DIR/wgsl_analyzer.js"
cp "$BUILD_DIR/wgsl_analyzer.wasm" "$OUT_DIR/"
rm -f "$OUT_DIR/wgsl-analyzer.js"

echo
ls -lh "$OUT_DIR"
