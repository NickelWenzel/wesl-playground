import { createSignal, For, Show } from 'solid-js'
import bevy_wgsl from './packages/bevy_wgsl.json'
import lygia_wgsl from './packages/lygia_wgsl.json'
import { Editor } from './Editor'
import { BsX as CloseIcon } from 'solid-icons/bs'

const files: Record<string, string> = Object.assign({}, bevy_wgsl, lygia_wgsl)
const filenames = Object.keys(files).sort()
const [selected, setSelected] = createSignal<string | null>(null)
const [revealLine, setRevealLine] = createSignal<number | undefined>()

/**
 * Opens a bundled module in the preview pane, used by go-to-definition when the
 * target lives in a package rather than in one of the user's tabs.
 * Returns false if the module is not one we ship.
 */
export function showPackageModule(module: string, line?: number): boolean {
  if (!(module in files)) return false
  setSelected(module)
  setRevealLine(line)
  return true
}

const FileList = () => (
  <div class="list">
    <ul>
      <For each={filenames}>
        {(f) => (
          <li>
            <a on:click={() => setSelected(f)}>{f}</a>
          </li>
        )}
      </For>
    </ul>
  </div>
)

const FilePreview = (props: { file: string }) => (
  <div class="preview">
    <div class="preview-header">
      <span>file: {props.file}</span>
      <button on:click={() => setSelected(null)}>
        <CloseIcon />
      </button>
    </div>
    <Editor
      content={files[props.file]}
      filepath={props.file}
      revealLine={revealLine()}
      readonly
    />
  </div>
)

export const PackageExplorer = () => (
  <div class="packages">
    {/* keyed: each module gets its own preview, so its editor model carries that
        module's URI instead of keeping the first previewed one forever. */}
    <Show when={selected()} keyed fallback=<FileList />>
      {(f) => <FilePreview file={f} />}
    </Show>
  </div>
)
