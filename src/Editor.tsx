import monaco, { editorWorker } from './monaco'

import { createEffect, onCleanup } from 'solid-js'
import { Diagnostic } from './wesl-web/wesl_web'
import { dark } from './Theme'
import { startLspClient } from './lsp/client'
import { modelFor } from './lsp/models'

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
  /** Tab name, for the editable editor. Its model is owned by lsp/models.ts. */
  file?: string
  /** Content and identity for read-only panes, which own their own model. */
  content?: string
  filepath?: string
  /** 1-based line to scroll to and highlight, for read-only previews. */
  revealLine?: number
  diagnostics?: Diagnostic[]
  readonly?: true
}

export const Editor = (props: EditorProps) => {
  let editor: monaco.editor.IStandaloneCodeEditor | undefined
  // Only read-only panes own a model; editable tabs borrow theirs from models.ts.
  let ownModel: monaco.editor.ITextModel | undefined
  const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>()

  function setupMonaco(elt: HTMLElement) {
    self.MonacoEnvironment = {
      getWorker: function (_workerId, _label) {
        return new editorWorker()
      },
    }

    if (props.readonly) {
      // Read-only panes (compiler output, package previews) use a non-workspace
      // scheme so they can never collide with a tab's file URI, and a language id
      // outside the server's document selector so they are never synced.
      // Built with Uri.from rather than Uri.parse because package paths contain
      // "::" and must not go through URI string parsing.
      const uri = monaco.Uri.from({
        scheme: 'pkg',
        path: `/${props.filepath ?? 'output'}`,
      })
      ownModel =
        monaco.editor.getModel(uri) ??
        monaco.editor.createModel(props.content ?? '', 'wgsl-readonly', uri)
    }

    editor = monaco.editor.create(elt, {
      model: ownModel ?? null,
      theme: 'theme',
      mouseWheelZoom: true,
      automaticLayout: true,
      readOnly: props.readonly ?? false,
      renderValidationDecorations: 'on',
    })

    // Boots wgsl-analyzer (wasm) in a worker on first use; a no-op afterwards.
    if (!props.readonly) startLspClient()
  }

  // Editable pane: swap models on tab switch. The model is the live document, so
  // there is no content to push — that is what makes each tab a separate file to
  // the language server.
  createEffect(() => {
    const name = props.file
    if (!editor || props.readonly || name === undefined) return
    const next = modelFor(name)
    if (!next || next === editor.getModel()) return

    const previous = editor.getModel()
    if (previous && !previous.isDisposed()) {
      viewStates.set(previous.uri.toString(), editor.saveViewState())
    }
    editor.setModel(next)
    const saved = viewStates.get(next.uri.toString())
    if (saved) editor.restoreViewState(saved)
  })

  // Read-only pane: content is pushed in, since nothing else writes to it.
  createEffect(() => {
    const content = props.content
    if (!props.readonly || !ownModel || content === undefined) return
    if (ownModel.getValue() !== content) {
      ownModel.setValue(content)
      editor?.setScrollTop(0)
    }
  })

  // Jump to a definition inside a read-only preview. Runs after the content
  // effect above, so the text is in place before we scroll to it.
  createEffect(() => {
    const line = props.revealLine
    if (!props.readonly || !editor || line === undefined) return
    editor.setPosition({ lineNumber: line, column: 1 })
    editor.revealLineInCenter(line)
  })

  // wesl-rs diagnostics for the visible document. The LSP publishes its own under
  // marker owner 'lsp', so the two do not clobber each other.
  createEffect(() => {
    const model = editor?.getModel()
    if (!model || model.isDisposed()) return
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

  onCleanup(() => {
    // Tab models outlive this component (models.ts owns them); only dispose what
    // this editor created, plus the editor itself, which was leaking before.
    editor?.dispose()
    ownModel?.dispose()
  })

  return <div class="editor" ref={setupMonaco}></div>
}
