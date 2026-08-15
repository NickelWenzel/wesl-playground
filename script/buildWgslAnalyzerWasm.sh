#!/usr/bin/env bash
# Builds wgsl-analyzer for the browser and copies the artifacts into public/.
#
# Threads require rebuilding std with the wasm `atomics` feature: the shipped
# rust-std for wasm32-unknown-emscripten is `singlethread: true`, so -pthread
# cannot link against it. Hence nightly + -Z build-std.
#
#   usage: script/buildWgslAnalyzerWasm.sh [--release]
set -euo pipefail

WA_DIR="${WA_DIR:-$(cd "$(dirname "$0")/../../wgsl-analyzer" && pwd)}"
EMSDK_DIR="${EMSDK_DIR:-$(cd "$(dirname "$0")/../../emsdk" && pwd)}"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/public/wgsl-analyzer"

PROFILE_DIR=debug
CARGO_PROFILE_ARGS=()
if [[ "${1:-}" == "--release" ]]; then
  PROFILE_DIR=release
  CARGO_PROFILE_ARGS=(--release)
fi

echo "wgsl-analyzer: $WA_DIR"
echo "emsdk:         $EMSDK_DIR"
echo "out:           $OUT_DIR"

# emcc is not on PATH by default.
# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1

cd "$WA_DIR"
cargo +nightly build \
  -Z build-std=std,panic_unwind \
  --package wgsl-analyzer --bin wgsl-analyzer \
  --target wasm32-unknown-emscripten \
  "${CARGO_PROFILE_ARGS[@]}"

BUILD_DIR="$WA_DIR/target/wasm32-unknown-emscripten/$PROFILE_DIR"
mkdir -p "$OUT_DIR"
# emscripten 6 does not emit a separate .worker.js — pthread workers re-run the
# main glue — so these two files are the whole payload.
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
