import { PATCH_BUS } from './PATCH_BUS.ts'
import type { Doc } from './types/Doc.ts'

/* Stack of in-flight captures, innermost last. `mountChild` wraps every hot-tracked child
   mount in its own `captureModelDoc`, and these NEST inside a parent's build, so a single
   shared PATCH_BUS would let a parent's listener (subscribed first) grab a nested child's
   model. Assigning each patch only to the innermost active capture keeps a component's model
   scoped to its OWN build. */
const captureStack: { model: Doc | undefined }[] = []

/*
Runs a component `build` and returns its result (the mount handle / disposer)
alongside the component's own `model` document — the serializable `state` doc,
needed so a hot swap can carry its value across (see `hotReplace`). The model is
found, not threaded: a component seeds its `model` first (the desugared
`const $$model = scope()` + its init `replace` patches (state slots lowered by `lowerDocAccess`) run before any child mounts or
control-flow blocks), so the FIRST patch announced during THIS build (not a nested
child's) names it. A component with no `state` mints no model and emits nothing first
— `model` is then `undefined` and there is nothing to preserve. A nested child mount
pushes its own frame, so its state-init patch names the child's model, not the parent's
(the M5 stateless-parent/stateful-child fix). Used only on the hot path; the subscription
is torn down with the build.
*/
export function captureModelDoc<T>(build: () => T): {
    value: T
    model: Doc | undefined
} {
    const frame: { model: Doc | undefined } = { model: undefined }
    captureStack.push(frame)
    const unsubscribe = PATCH_BUS.subscribe((event) => {
        /* Only the innermost active capture claims a patch — a nested child mounting during
           this build has pushed a deeper frame, so its patches don't leak up to this one. */
        if (captureStack[captureStack.length - 1] === frame) {
            frame.model ??= event.doc
        }
    })
    try {
        return { value: build(), model: frame.model }
    } finally {
        unsubscribe()
        captureStack.pop()
    }
}
