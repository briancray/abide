import { memo } from 'abide/shared/memo'
import { state } from 'abide/shared/state'
import { watch } from 'abide/shared/watch'

// An isomorphic reactive value owned by the SERVER, living in a shared module — the SAME `state()`
// primitive UI components use, here running in plain server `.ts`. Other server modules import `total`,
// derive from it, and subscribe to it: a server-side reactive graph, no client involved.
//
// NOTE the explicit `total()` / `total.set(...)` calls below. In a `.abide` `<script>` you write bare
// `total` / `total = x` and the compiler rewrites those to `total()` / `total.set(x)` for you.
// There is no compiler here — plain `.ts` — so you call the `State` surface yourself:
//   total()           // tracked read (subscribes the surrounding memo/watch)
//   total.set(next)   // publish a new value
//   total.untracked() // untracked read (no subscription)
//
// It is `untracked()`, not `peek()`, because `peek` means the OPPOSITE on the other two primitives:
// `memo.peek(args)` / `channel.peek(args)` SUBSCRIBE and return `T | undefined` (ADR 0027 D2). Both
// spellings appear side by side one file over, in `serverReactiveRead.ts`.
//
// Module-level state is PROCESS-GLOBAL (one value across all requests) — fine for this global counter;
// for mutable per-request/per-user state, use `memo({ crossRequest })` instead.
export const total = state(0)

// A derived value in the same module — recomputes off `total` on read. An argless `memo` declares no
// inputs, so they are inferred from the body (ADR 0024): calling `total()` inside it is what wires the
// dependency, and the bare call `doubled()` returns the value, not a promise.
export const doubled = memo(() => total() * 2)

// A live server-side subscription: this `watch` fires whenever `total` changes, from ANY module that
// writes it — proof the graph is reactive on the server, not just recompute-on-read.
let fires = 0
watch(
    () => total(),
    () => {
        fires++
    },
)
export function watchFires(): number {
    return fires
}
