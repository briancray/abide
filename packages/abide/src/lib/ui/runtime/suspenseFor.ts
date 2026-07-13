import type { ReactiveNode } from './types/ReactiveNode.ts'
import type { Suspense } from './types/Suspense.ts'

/*
Associates an effect node with the client suspense boundary it was created inside — the sibling of
`boundaryFor`. Kept OFF the `ReactiveNode` shape (a WeakMap populated only for effects built while
`CURRENT_SUSPENSE.current` is set) so the node stays monomorphic on the read/write hot path, and
this map is consulted only on the cold throw path (`flushEffects.drain`'s catch) to route a guarded
effect's `SuspenseSignal` to its boundary. Separate from `boundaryFor` so a suspend can never be
mistaken for an error and routed to a `{#try}`.
*/
export const suspenseFor = new WeakMap<ReactiveNode, Suspense>()
