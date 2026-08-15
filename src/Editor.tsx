import monaco, { editorWorker } from './monaco'

import { createEffect, onCleanup } from 'solid-js'
import { Diagnostic } from './wesl-web/wesl_web'
import { dark } from './Theme'
import { startLspClient } from './lsp/client'
import { WORKSPACE_PATH } from './lsp/workspace'

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

    // Must match the emscripten MEMFS layout the LSP worker seeds; see lsp/workspace.ts.
    const uri = monaco.Uri.parse(`file://${WORKSPACE_PATH}/` + props.filepath)
    // The LSP client syncs *every* monaco model to the server. Readonly editors
    // (compiler output, package previews) get their own language id so they are
    // outside the server's documentSelector and never opened as workspace files.
    const languageId = props.readonly ? 'wgsl-readonly' : 'wgsl'
    model =
      monaco.editor.getModel(uri) ??
      monaco.editor.createModel(props.content, languageId, uri)

    const editor = monaco.editor.create(elt, {
      // value: props.content,
      model,
      theme: 'theme',
      language: languageId,
      mouseWheelZoom: true,
      automaticLayout: true,
      readOnly: props.readonly ?? false,
      renderValidationDecorations: 'on',
    })

    // Boots wgsl-analyzer (wasm) in a worker on first use; a no-op afterwards.
    if (!props.readonly) startLspClient()

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
