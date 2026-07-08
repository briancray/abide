import type { Boundary } from './types/Boundary.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'

/*
Associates an effect node with the reactive `{#try}` boundary it was created inside. Kept
OFF the `ReactiveNode` shape — a WeakMap populated only for effects built while
`CURRENT_BOUNDARY.current` is set — so the node stays monomorphic for signals/computeds/
effects on the read/write hot path, and this map is consulted only on the cold throw path
(`flushEffects.drain`'s catch), to route a guarded effect's later-run throw to its boundary.
*/
export const boundaryFor = new WeakMap<ReactiveNode, Boundary>()
