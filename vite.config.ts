import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import wasm from 'vite-plugin-wasm'
// import devtools from 'solid-devtools/vite';

export default defineConfig({
  plugins: [
    // devtools(),
    wasm(),
    solid(),
  ],
  resolve: {
    alias: {
      // src/monaco-lsp-client is a prebuilt bundle that imports 'monaco-editor-core'.
      // Alias it so it shares the single monaco instance the app uses — provider
      // registration is global, so two instances would silently do nothing.
      'monaco-editor-core': 'monaco-editor',
    },
  },
  // wgsl-analyzer.wasm is built with -pthread, so it needs SharedArrayBuffer,
  // which needs a cross-origin-isolated context.
  server: {
    port: 3000,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  worker: {
    format: 'es',
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
