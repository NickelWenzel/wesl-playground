import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import wasm from 'vite-plugin-wasm'
// import devtools from 'solid-devtools/vite';

// wgsl-analyzer is built with -pthread, so it needs SharedArrayBuffer, which
// needs a cross-origin isolated page. Production gets these from public/_headers.
// Its assets are copied to public/wgsl-analyzer by script/copyWgslAnalyzerAssets.js.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [
    // devtools(),
    wasm(),
    solid(),
  ],
  server: {
    port: 3000,
    headers: crossOriginIsolation,
  },
  preview: {
    headers: crossOriginIsolation,
  },
  build: {
    target: 'esnext',
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      },
    },
  },
})
