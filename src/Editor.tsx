import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import { startLsp } from './lsp'

import { createEffect, onCleanup } from 'solid-js'
import { Diagnostic } from './wesl-web/wesl_web'
import { dark } from './Theme'

self.MonacoEnvironment = {
  getWorker: function (_workerId, _label) {
    return new editorWorker()
  },
}

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

// shows a model owned by the caller
interface ModelProps {
  model: monaco.editor.ITextModel | undefined
}

// owns a model built from `content` at the absolute path `filepath`
interface ContentProps {
  content: string
  filepath: string
}

type EditorProps = (ModelProps | ContentProps) & {
  diagnostics?: Diagnostic[]
  readonly?: true
  onchange?: (content: string) => void
}

export const Editor = (props: EditorProps) => {
  let ownModel: monaco.editor.ITextModel | undefined

  function setupMonaco(elt: HTMLElement) {
    const editor = monaco.editor.create(elt, {
      model: null,
      theme: 'theme',
      language: 'wgsl',
      mouseWheelZoom: true,
      automaticLayout: true,
      readOnly: props.readonly ?? false,
      renderValidationDecorations: 'on',
    })

    startLsp()

    const model = () => ('model' in props ? props.model : ownModel)

    if ('model' in props) {
      createEffect(() => editor.setModel(props.model ?? null))
    } else {
      const uri = monaco.Uri.file(props.filepath)
      ownModel =
        monaco.editor.getModel(uri) ??
        monaco.editor.createModel(props.content, 'wgsl', uri)
      editor.setModel(ownModel)

      // comparing with the model avoids calling editor.setValue() when content
      // changed as a result of editing.
      createEffect(() => {
        if (props.content !== ownModel!.getValue()) {
          editor.setValue(props.content)
          editor.setScrollTop(0)
        }
      })
    }

    // flushes come from setValue(), i.e. from content the caller already has.
    editor.onDidChangeModelContent((e) => {
      if (!e.isFlush) props.onchange?.(editor.getValue())
    })

    createEffect(() => {
      const current = model()
      if (!current) return
      const markers = (props.diagnostics ?? []).map((d) => {
        const p1 = current.getPositionAt(d.span.start)
        const p2 = current.getPositionAt(d.span.end)
        return {
          startLineNumber: p1.lineNumber,
          startColumn: p1.column,
          endLineNumber: p2.lineNumber,
          endColumn: p2.column,
          message: d.title,
          severity: monaco.MarkerSeverity.Error,
        }
      })
      monaco.editor.setModelMarkers(current, 'wesl', markers)
    })
  }

  onCleanup(() => {
    if (ownModel) ownModel.dispose()
  })

  return <div class="editor" ref={setupMonaco}></div>
}
