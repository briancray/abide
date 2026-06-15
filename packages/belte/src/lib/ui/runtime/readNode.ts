import { runNode } from './runNode.ts'
import { track } from './track.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'

/*
Reads a node's current value and subscribes the running observer to it. A dirty
computed recomputes first (lazy pull); a signal returns its stored value
directly. Tracking happens after recompute so the reader links to the computed
itself, not its transitive deps.
*/
export function readNode(node: ReactiveNode): unknown {
    if (node.compute !== undefined && node.dirty) {
        runNode(node)
    }
    track(node)
    return node.value
}
