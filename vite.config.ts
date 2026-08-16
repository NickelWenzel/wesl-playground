import { defineConfig, type Plugin } from 'vite'
import solid from 'vite-plugin-solid'
import wasm from 'vite-plugin-wasm'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// import devtools from 'solid-devtools/vite';

// The committed release wgsl-analyzer, served as opaque bytes at a fixed prefix.
//
// The emscripten glue must never enter Vite's module graph. It self-spawns its
// pthread workers with `new Worker(new URL("wgsl_analyzer.js", import.meta.url),
// {...})`, and `vite:worker-import-meta-url` eval()s that options object to pick
// the worker type. The object is not static, so it throws
// `Vite is unable to parse the worker options` — a 500 in dev, an aborted build
// in production. `?url` is not a way out either: the dev URL it hands back is
// under /src/, so fetching it re-enters transformMiddleware and hits the same
// throw. Hence: never imported, just streamed in dev and copied on build.
//
// Wherever they are served from, the two files must stay siblings and the glue
// must keep the name `wgsl_analyzer.js`, or every pthread 404s.
const ANALYZER_ROUTE = '/wgsl-analyzer-web'
const ANALYZER_DIR = fileURLToPath(
  new URL('./src/wgsl-analyzer-web', import.meta.url),
)
const ANALYZER_FILES = ['wgsl_analyzer.js', 'wgsl_analyzer.wasm']
const CONTENT_TYPE: Record<string, string> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
}

function wgslAnalyzerWeb(): Plugin {
  let outDir = 'dist'
  let useDebugBuild = false
  return {
    name: 'wgsl-analyzer-web',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
      // Matches the check in src/lsp/wgslAnalyzer.worker.ts. Read from the
      // loaded env rather than process.env so a .env file works too.
      useDebugBuild = config.env.VITE_WGSL_ANALYZER === 'debug'
    },
    configureServer(server) {
      // Registered synchronously in the hook body rather than from a returned
      // function: configureServer hooks are awaited before Vite pushes any of
      // its own middleware, while returned hooks run after transform and static.
      // We have to be ahead of transformMiddleware to serve the glue verbatim.
      server.middlewares.use(ANALYZER_ROUTE, (req, res, next) => {
        // Connect strips the mount prefix from req.url.
        const name = decodeURIComponent((req.url ?? '').split('?')[0]).replace(
          /^\/+/,
          '',
        )
        // Being first in the stack also puts us ahead of Vite's host and CORS
        // checks, so the route exposes exactly the two files the build copies,
        // and nothing else in the directory.
        if (!ANALYZER_FILES.includes(name)) return next()
        const file = path.join(ANALYZER_DIR, name)

        let stat: fs.Stats
        try {
          stat = fs.statSync(file)
        } catch {
          return next()
        }
        if (!stat.isFile()) return next()

        // Without a validator every reload re-transfers ~20 MB.
        const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`
        res.setHeader('ETag', etag)
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader(
          'Content-Type',
          CONTENT_TYPE[path.extname(file)] ?? 'application/octet-stream',
        )
        if (req.headers['if-none-match'] === etag) {
          res.statusCode = 304
          return res.end()
        }
        res.setHeader('Content-Length', String(stat.size))
        if (req.method === 'HEAD') return res.end()
        fs.createReadStream(file).pipe(res)
      })
    },
    // Copied rather than emitted: `emitFile` with an explicit `fileName` would
    // also bypass hashing, but it parks the whole artifact in the bundle object
    // until write. writeBundle is never invoked for the ?worker sub-bundle
    // (that path calls bundle.generate(), not write()), so this runs once.
    writeBundle() {
      const dest = path.join(outDir, ANALYZER_ROUTE.slice(1))
      fs.mkdirSync(dest, { recursive: true })
      for (const name of ANALYZER_FILES) {
        const from = path.join(ANALYZER_DIR, name)
        if (!fs.existsSync(from)) {
          this.error(
            `${from} is missing — run script/buildWgslAnalyzerRelease.sh`,
          )
        }
        fs.copyFileSync(from, path.join(dest, name))
      }

      // Vite copies publicDir verbatim, so a developer who has run the debug
      // prototype script would otherwise ship its ~67 MB build alongside this
      // one. Nothing loads it unless VITE_WGSL_ANALYZER=debug, so drop it.
      if (!useDebugBuild) {
        const stray = path.join(outDir, 'wgsl-analyzer')
        if (fs.existsSync(stray)) {
          fs.rmSync(stray, { recursive: true, force: true })
          this.warn(
            'removed the debug analyzer build from the output; set VITE_WGSL_ANALYZER=debug to ship it instead',
          )
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [
    // devtools(),
    wasm(),
    solid(),
    wgslAnalyzerWeb(),
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
