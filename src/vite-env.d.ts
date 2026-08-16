/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Set to `debug` to load the analyzer from `public/wgsl-analyzer/` (the output
   * of `script/buildWgslAnalyzerWasm.sh`) instead of the committed release build
   * in `src/wgsl-analyzer-web/`. Read at compile time, so it must be set when
   * vite starts:
   *
   *   VITE_WGSL_ANALYZER=debug npm run dev
   */
  readonly VITE_WGSL_ANALYZER?: 'debug'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
