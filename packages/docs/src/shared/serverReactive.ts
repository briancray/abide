import { state } from 'abide/shared/state'
import { watch } from 'abide/shared/watch'

// An isomorphic reactive value owned by the SERVER, living in a shared module — the SAME `state()`
// primitive UI components use, here running in plain server `.ts`. Other server modules import `total`,
// derive from it, and subscribe to it: a server-side reactive graph, no client involved.
//
// Module-level state is PROCESS-GLOBAL (one value across all requests) — fine for this global counter;
// for mutable per-request/per-user state, use `cell({ shared })` instead.
export const total = state(0)

// A derived value in the same module — recomputes off `total` on read.
export const doubled = state.computed(() => total.read() * 2)

// A live server-side subscription: this `watch` fires whenever `total` changes, from ANY module that
// writes it — proof the graph is reactive on the server, not just recompute-on-read.
let fires = 0
watch(
    () => total.read(),
    () => {
        fires++
    },
)
export function watchFires(): number {
    return fires
}
