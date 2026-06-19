import { PATCH_BUS } from './PATCH_BUS.ts'
import type { Doc } from './types/Doc.ts'

/*
Runs a component `build` and returns its disposer alongside the component's own
`model` document — the serializable `state` doc, needed so a hot swap can carry
its value across (see `hotReplace`). The model is found, not threaded: a component
seeds its `model` first (the desugared `const model = doc({})` + its init patches
run before any child mounts or control-flow blocks), so the FIRST patch announced
on the bus during the build names it. A component with no `state` mints no model
and emits nothing first — `model` is then `undefined` and there is nothing to
preserve. Used only on the hot path; the subscription is torn down with the build.
*/
export function captureModelDoc(build: () => () => void): {
    dispose: () => void
    model: Doc | undefined
} {
    let model: Doc | undefined
    const unsubscribe = PATCH_BUS.subscribe((event) => {
        model ??= event.doc
    })
    let dispose: () => void = () => undefined
    try {
        dispose = build()
    } finally {
        unsubscribe()
    }
    return { dispose, model }
}
