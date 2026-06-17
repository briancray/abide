import type { UiComponent } from './UiComponent.ts'

/*
A live component instance the hot-reload registry tracks: its wrapper host, the
factory that built it, the props (thunks re-read on a swap so the parent's live
state still flows through), and the disposer for its current scope + DOM. A swap
mutates `factory`/`dispose` in place (see `hotReplace`).
*/
export type HotInstance = {
    host: Element
    factory: UiComponent
    props: Parameters<UiComponent>[1]
    dispose: () => void
}
