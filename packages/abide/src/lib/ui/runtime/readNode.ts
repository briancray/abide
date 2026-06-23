import { track } from './track.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'
import { updateIfNecessary } from './updateIfNecessary.ts'

/*
Reads a node's current value and subscribes the running observer to it. A computed
settles first (the lazy pull — `updateIfNecessary` refreshes only the deps that
changed, recomputing if any did); a signal has no compute and returns its stored
value directly. Tracking happens after the settle so the reader links to the
computed itself, not its transitive deps.
*/
export function readNode(node: ReactiveNode): unknown {
    if (node.compute !== undefined) {
        updateIfNecessary(node)
    }
    track(node)
    return node.value
}
