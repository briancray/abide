import type { Doc } from './Doc.ts'
import type { UiComponent } from './UiComponent.ts'

/*
A live component instance the hot-reload registry tracks: the `start`/`end` markers
bounding its DOM range (the wrapper-free mount, see `mountRange`), its `label` (the
scope name), the factory that built it, the props (thunks re-read on a swap so the
parent's live state still flows through), the disposer for its current scope + DOM,
and its own `model` document (`undefined` when the component has no `state`) —
snapshotted before a swap and re-seeded after, so the user's in-progress state
survives the edit. A swap re-fills the SAME range and mutates `factory`/`dispose`/
`model` in place (see `hotReplace`).
*/
export type HotInstance = {
    start: Comment
    end: Comment
    label: string | undefined
    factory: UiComponent
    props: Parameters<UiComponent>[1]
    dispose: () => void
    model: Doc | undefined
}
