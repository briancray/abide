import { state } from 'abide/shared/state'
import { watch } from 'abide/shared/watch'

// An isomorphic reactive value owned by the SERVER, living in a shared module — the SAME `state()`
// primitive UI components use, here running in plain server `.ts`. Other server modules import `total`,
// derive from it, and subscribe to it: a server-side reactive graph, no client involved.
//
// NOTE the explicit `.read()` / `.write()` calls below. In a `.abide` `<script>` you write bare
// `total` / `total = x` and the compiler rewrites those to `total.read()` / `total.write(x)` for you.
// There is no compiler here — plain `.ts` — so you call the `State` methods yourself:
//   total.read()      // tracked read (subscribes the surrounding computed/watch)
//   total.write(next) // publish a new value
//   total.peek()      // untracked read (no subscription)
//
// Module-level state is PROCESS-GLOBAL (one value across all requests) — fine for this global counter;
// for mutable per-request/per-user state, use `cell({ shared })` instead.
export const total = state(0)

// A derived value in the same module — recomputes off `total` on read. `total.read()` inside the
// `computed` callback is what wires the dependency (bare `total` would just capture the cell object).
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
