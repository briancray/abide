import { OWNER } from './OWNER.ts'
import { untrack } from './untrack.ts'

/*
Runs `build` under a fresh ownership scope so every effect and listener created
inside is collected, and returns a disposer that tears them all down in reverse
order (children before parents). Save/restore of the previous owner makes scopes
nest — a list row's scope sits inside its component's scope.

The build runs UNTRACKED. A detached subtree is built synchronously, and when that
build happens inside a swap effect (a control-flow block re-running `each`/`when`/
`switch`/`await`) its top-level reads would otherwise subscribe THAT effect, so any
in-content state change would re-run the block and rebuild the whole subtree. The
content's own interpolations still track normally — each wraps its read in its own
effect, which re-installs itself as the observer. Untracking here is the framework's
invariant (a build never subscribes its builder) stated once, so no control-flow
block has to remember it; it's a harmless no-op for top-level builds (mount/hydrate),
where there is no surrounding observer to leak into.
*/
export function scope(build: () => void): () => void {
    const previous = OWNER.current
    const disposers: Array<() => void> = []
    OWNER.current = disposers
    try {
        untrack(build)
    } finally {
        OWNER.current = previous
    }
    return () => {
        for (let index = disposers.length - 1; index >= 0; index -= 1) {
            disposers[index]?.()
        }
        disposers.length = 0
    }
}
