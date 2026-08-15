// Owns one Monaco model per playground tab.
//
// Model lifecycle *is* the LSP file lifecycle: creating a model sends didOpen,
// editing sends didChange, disposing sends didClose. Measured against the real
// server, that is sufficient on its own — a didOpen'd file becomes part of the
// package with nothing on disk, and didClose removes it again. So there is no
// filesystem to keep in sync for the user's files, and rename is just
// close-then-open at the new path.
//
// Models are created for ALL tabs and kept alive, not created lazily when a tab is
// first visited: an unopened file is invisible to the analyzer, so `main` could not
// import `bindings` until you had clicked `bindings`. Diagnostics are likewise only
// computed for open documents.
//
// This lives outside the component tree on purpose — <Editor> mounts three times.

import monaco from '../monaco'
import { moduleForVendorPath, resolveFiles } from './workspace'

/** name -> model, for every tab currently representable as a workspace file. */
const models = new Map<string, monaco.editor.ITextModel>()
const listeners = new Map<string, monaco.IDisposable>()

let onEdit: ((name: string, content: string) => void) | undefined
let onActivate: ((name: string) => void) | undefined
let onOpenPackage:
  | ((module: string, line?: number) => boolean)
  | undefined

/** Registers the callback used to push editor edits back into the store. */
export function setEditHandler(
  handler: (name: string, content: string) => void,
): void {
  onEdit = handler
}

/** Registers the callback that makes a tab the visible one. */
export function setActivateHandler(handler: (name: string) => void): void {
  onActivate = handler
}

/**
 * Registers the callback that shows a bundled module, for definitions that land
 * in a package rather than a tab. Should return false if it cannot show it.
 * Injected rather than imported so this module stays free of the UI, which
 * imports it back through <Editor>.
 */
export function setPackageHandler(
  handler: (module: string, line?: number) => boolean,
): void {
  onOpenPackage = handler
}

export const modelFor = (name: string) => models.get(name)

/** Reverse of modelFor: which tab, if any, owns this document URI. */
export function nameForUri(uri: monaco.Uri): string | undefined {
  const target = uri.toString()
  for (const [name, model] of models) {
    if (model.uri.toString() === target) return name
  }
  return undefined
}

function create(name: string, path: string, source: string) {
  const uri = monaco.Uri.parse(`file://${path}`)
  // Reuse rather than recreate: a stale model at this URI would be a second
  // document for the same file.
  const model =
    monaco.editor.getModel(uri) ??
    monaco.editor.createModel(source, 'wgsl', uri)
  models.set(name, model)
  listeners.set(
    name,
    model.onDidChangeContent(() => onEdit?.(name, model.getValue())),
  )
  return model
}

function destroy(name: string) {
  listeners.get(name)?.dispose()
  listeners.delete(name)
  models.get(name)?.dispose()
  models.delete(name)
}

/**
 * Brings the model set in line with `files`. Safe to call on every store change —
 * it is a no-op when only content changed, so typing does not churn models.
 *
 * Renames arrive here as "one name gone, one name new", because the tab name is
 * the file identity. That loses the undo stack for a renamed tab.
 */
export function reconcile(
  files: readonly { name: string; source: string }[],
): void {
  const { resolved, collisions } = resolveFiles(files)
  if (collisions.length > 0) {
    console.warn(
      `[wgsl-analyzer] these tabs are not visible to the language server ` +
        `because their names map to a file that is already taken: ${collisions.join(', ')}`,
    )
  }

  const wanted = new Map(resolved.map((file) => [file.name, file]))

  // Drop departed tabs first, so a rename frees its old path before the new
  // model claims one, and an a<->b swap never has both live at once.
  for (const name of [...models.keys()]) {
    if (!wanted.has(name)) destroy(name)
  }

  for (const { name, path, source } of resolved) {
    const existing = models.get(name)
    if (!existing) {
      create(name, path, source)
    } else if (existing.getValue() !== source) {
      // Only external replacements (shared-URL load, reset) reach this: the
      // user's own typing already flowed model -> store, so the values match and
      // we must not write back into the model they are editing.
      existing.setValue(source)
    }
  }
}

/** Disposes every model. Only used when tearing the workspace down. */
export function disposeAll(): void {
  for (const name of [...models.keys()]) destroy(name)
}

// Cross-file navigation. A standalone monaco editor only ever shows the model it
// was given: when go-to-definition lands in a *different* document it asks this
// hook to open it, and does nothing at all if no hook claims it. That is why
// jumping to another tab silently failed even though the server was returning the
// right target.
monaco.editor.registerEditorOpener({
  openCodeEditor(source, resource, selectionOrPosition) {
    const name = nameForUri(resource)
    const model = name === undefined ? undefined : models.get(name)

    if (name === undefined || !model) {
      // Not one of the user's tabs. Bundled packages have no tab and are not
      // editable, so they open read-only in the package explorer instead.
      const module = moduleForVendorPath(resource.path)
      if (module === undefined) return false
      const line =
        selectionOrPosition && 'startLineNumber' in selectionOrPosition
          ? selectionOrPosition.startLineNumber
          : selectionOrPosition?.lineNumber
      return onOpenPackage?.(module, line) ?? false
    }

    // Switch the tab first so the UI agrees, then point this editor at the model
    // directly — the reactive swap in Editor.tsx is idempotent, and doing it here
    // means the reveal below happens against the right document immediately.
    onActivate?.(name)
    if (source.getModel() !== model) source.setModel(model)

    if (selectionOrPosition) {
      const range =
        'startLineNumber' in selectionOrPosition
          ? selectionOrPosition
          : {
              startLineNumber: selectionOrPosition.lineNumber,
              startColumn: selectionOrPosition.column,
              endLineNumber: selectionOrPosition.lineNumber,
              endColumn: selectionOrPosition.column,
            }
      source.setSelection(range)
      source.revealRangeInCenterIfOutsideViewport(range)
    }
    source.focus()
    return true
  },
})
