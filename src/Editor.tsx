import monaco from './monaco'
import { startLsp } from './lsp'

import { createEffect, onCleanup } from 'solid-js'
import type { Diagnostic } from 'wesl-rs-web'
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

interface EditorProps {
  // owned by the caller
  model: monaco.editor.ITextModel | undefined
  diagnostics?: Diagnostic[]
  readonly?: true
  onchange?: (content: string) => void
}

export const Editor = (props: EditorProps) => {
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

    onCleanup(() => editor.dispose())

    startLsp()

    createEffect(() => editor.setModel(props.model ?? null))

    // flushes come from model.setValue(), i.e. from content the caller already has.
    editor.onDidChangeModelContent((e) => {
      if (!e.isFlush) props.onchange?.(editor.getValue())
    })

    createEffect(() => {
      const model = props.model
      if (!model) return
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

  return <div class="editor" ref={setupMonaco}></div>
}
