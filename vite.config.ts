import { defineConfig, type Plugin } from 'vite'
import solid from 'vite-plugin-solid'
import wasm from 'vite-plugin-wasm'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// import devtools from 'solid-devtools/vite';

// wgsl-analyzer is built with -pthread, so it needs SharedArrayBuffer, which
// needs a cross-origin isolated page. Production gets these from public/_headers.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

// Served at the default `baseUrl` of `WgslAnalyzerServer.start`.
const ANALYZER_ROUTE = '/wgsl-analyzer'
const ANALYZER_DIR = fileURLToPath(
  new URL('./node_modules/wgsl-analyzer-web/dist/assets', import.meta.url),
)
const ANALYZER_FILES = ['worker.js', 'wgsl_analyzer.js', 'wgsl_analyzer.wasm']
const CONTENT_TYPE: Record<string, string> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
}

// The analyzer assets must be served verbatim, side by side, under their own
// names: the emscripten glue spawns its pthreads with
// `new Worker(new URL("wgsl_analyzer.js", import.meta.url), {...})`, which
// vite's worker transform cannot parse. So they never enter the module graph;
// they are streamed in dev and copied on build.
function wgslAnalyzerAssets(): Plugin {
  let outDir = 'dist'
  return {
    name: 'wgsl-analyzer-assets',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      // Registered here rather than from a returned hook so it runs ahead of
      // vite's transform middleware. That also puts it ahead of the middleware
      // applying `server.headers`, so the headers are set by hand: without COEP
      // on the glue, the browser blocks the pthread workers and the server
      // silently never starts.
      server.middlewares.use(ANALYZER_ROUTE, (req, res, next) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\/+/, '')
        if (!ANALYZER_FILES.includes(name)) return next()
        const file = path.join(ANALYZER_DIR, name)
        for (const [key, value] of Object.entries(crossOriginIsolation))
          res.setHeader(key, value)
        res.setHeader('Content-Type', CONTENT_TYPE[path.extname(file)])
        fs.createReadStream(file).pipe(res)
      })
    },
    writeBundle() {
      const dest = path.join(outDir, ANALYZER_ROUTE)
      fs.mkdirSync(dest, { recursive: true })
      for (const name of ANALYZER_FILES)
        fs.copyFileSync(path.join(ANALYZER_DIR, name), path.join(dest, name))
    },
  }
}

export default defineConfig({
  plugins: [
    // devtools(),
    wasm(),
    solid(),
    wgslAnalyzerAssets(),
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
