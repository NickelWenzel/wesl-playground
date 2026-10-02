import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import { WgslAnalyzerServer } from 'wgsl-analyzer-web'
import { WgslAnalyzerTransport } from './lsp_transport'

import { createEffect, onCleanup } from 'solid-js'
import { Diagnostic } from './wesl-web/wesl_web'
import { dark } from './Theme'

// update dark/light monaco theme
createEffect(() => {
  monaco.editor.defineTheme('theme', {
    base: dark() ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': dark() ? '#262a2f' : '#efefef',
    },
  })
})

// one language server for every editor: the client syncs all monaco models.
let lspStarted = false

function startLsp() {
  if (lspStarted) return
  lspStarted = true
  WgslAnalyzerServer.start({
    files: {},
    onStderr: (line) => console.log(line),
    onExit: (code) => console.log(`wgsl_analyzer lsp exited with code ${code}`),
  })
    .then((server) => {
      const client = new monaco.lsp.MonacoLspClient(
        new WgslAnalyzerTransport(server),
      )
      console.log('initialized lsp', client)
    })
    .catch((e) => {
      console.error('failed to start wgsl_analyzer lsp', e)
    })
}

interface EditorProps {
  content: string
  filepath: string
  diagnostics?: Diagnostic[]
  readonly?: true
  onchange?: (content: string) => void
}

export const Editor = (props: EditorProps) => {
  let model: monaco.editor.ITextModel

  function setupMonaco(elt: HTMLElement) {
    self.MonacoEnvironment = {
      getWorker: function (_workerId, _label) {
        return new editorWorker()
      },
    }

    const uri = monaco.Uri.parse('file:///' + props.filepath)
    model =
      monaco.editor.getModel(uri) ??
      monaco.editor.createModel(props.content, 'wgsl', uri)

    const editor = monaco.editor.create(elt, {
      // value: props.content,
      model,
      theme: 'theme',
      language: 'wgsl',
      mouseWheelZoom: true,
      automaticLayout: true,
      readOnly: props.readonly ?? false,
      renderValidationDecorations: 'on',
    })

    startLsp()

    // keeping track of the editor content avoids calling editor.setValue() when source()
    // changed as a result of editing.
    let currentContent = props.content

    editor.getModel()!.onDidChangeContent(() => {
      currentContent = editor.getValue()
      props.onchange?.(currentContent)
    })

    createEffect(() => {
      if (props.content !== currentContent) {
        editor.setValue(props.content)
        editor.setScrollTop(0)
      }
    })

    createEffect(() => {
      const model = editor.getModel()!
      const markers = (props.diagnostics ?? []).map((d) => {
        const p1 = model.getPositionAt(d.span.start)
        const p2 = model.getPositionAt(d.span.end)
        return {
          startLineNumber: p1.lineNumber,
          startColumn: p1.column,
          endLineNumber: p2.lineNumber,
          endColumn: p2.column,
          message: d.title,
          severity: monaco.MarkerSeverity.Error,
        }
      })
      monaco.editor.setModelMarkers(model, 'wesl', markers)
    })
  }

  onCleanup(() => {
    if (model) model.dispose()
  })

  return <div class="editor" ref={setupMonaco}></div>
}
