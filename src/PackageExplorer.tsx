import { createSignal, For, Show } from 'solid-js'
import bevy_wgsl from './packages/bevy_wgsl.json'
import lygia_wgsl from './packages/lygia_wgsl.json'
import { Editor } from './Editor'
import { packageModel } from './lsp'
import { BsX as CloseIcon } from 'solid-icons/bs'

const files: Record<string, string> = Object.assign({}, bevy_wgsl, lygia_wgsl)
const filenames = Object.keys(files).sort()
const [selected, setSelected] = createSignal<string | null>(null)

export const openPackageFile = (module: string) => setSelected(module)

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
    <Editor model={packageModel(props.file)} readonly />
  </div>
)

export const PackageExplorer = () => (
  <div class="packages">
    <Show when={selected()} keyed fallback=<FileList />>
      {(f) => <FilePreview file={f} />}
    </Show>
  </div>
)
