// Single, process-wide LSP client.
//
// MonacoLspClient registers its providers against the global monaco singleton, so
// creating one per <Editor> mount (there are three) would register every provider
// three times. This module owns exactly one.

import { MonacoLspClient, createTransportToWorker } from '../monaco-lsp-client'
import WgslAnalyzerWorker from './wgslAnalyzer.worker?worker'
import { VENDOR_URI, WORKSPACE_URI } from './workspace'

let client: MonacoLspClient | undefined

export function startLspClient(): MonacoLspClient | undefined {
  if (client) return client

  // -pthread means the wasm needs SharedArrayBuffer, which needs COOP/COEP.
  // Fail loudly here rather than as an opaque wasm instantiation error.
  if (!self.crossOriginIsolated) {
    console.error(
      '[wgsl-analyzer] not cross-origin isolated — SharedArrayBuffer is unavailable, ' +
        'so the threaded wasm build cannot start. Check the COOP/COEP headers in vite.config.ts.',
    )
    return undefined
  }

  const worker = new WgslAnalyzerWorker()
  worker.addEventListener('message', (event: MessageEvent) => {
    // The worker logs as strings; the transport only consumes objects.
    if (typeof event.data === 'string') console.debug(event.data)
  })

  try {
    client = new MonacoLspClient(createTransportToWorker(worker), {
      rootUri: WORKSPACE_URI,
      // The bundled packages live outside the user's package, so they need their
      // own workspace folder — package discovery is gated on membership.
      workspaceFolders: [
        { uri: WORKSPACE_URI, name: 'workspace' },
        { uri: VENDOR_URI, name: 'vendor' },
      ],
    })
  } catch (error) {
    console.error('[wgsl-analyzer] failed to start LSP client', error)
    return undefined
  }
  return client
}
