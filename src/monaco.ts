import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'

self.MonacoEnvironment = {
  getWorker: function (_workerId, _label) {
    return new editorWorker()
  },
}

let showResource: (resource: monaco.Uri) => boolean = () => false

/**
 * Handles go-to-definition into another file, which a standalone monaco editor
 * cannot open by itself: `show` must put `resource` in an editor and return
 * true, then the opener reveals the target range in that editor.
 */
export function setResourceOpener(show: (resource: monaco.Uri) => boolean) {
  showResource = show
}

monaco.editor.registerEditorOpener({
  openCodeEditor(_source, resource, selectionOrPosition) {
    if (!showResource(resource)) return false
    const editor = monaco.editor
      .getEditors()
      .find((e) => e.getModel()?.uri.toString() === resource.toString())
    if (!editor) return false
    if (selectionOrPosition && monaco.Range.isIRange(selectionOrPosition)) {
      editor.setSelection(selectionOrPosition)
      editor.revealRangeInCenter(selectionOrPosition)
    } else if (selectionOrPosition) {
      editor.setPosition(selectionOrPosition)
      editor.revealPositionInCenter(selectionOrPosition)
    }
    editor.focus()
    return true
  },
})

export default monaco
