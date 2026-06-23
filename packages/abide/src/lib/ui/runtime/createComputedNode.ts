import { NODE_STATE } from './NODE_STATE.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'

/* Creates a lazy computed node. Born DIRTY so its first read computes; thereafter a
   read settles it — recomputing only when the check walk finds a dependency whose
   value actually changed. */
export function createComputedNode(compute: () => unknown): ReactiveNode {
    return {
        value: undefined,
        compute,
        depsHead: undefined,
        depsTail: undefined,
        subsHead: undefined,
        subsTail: undefined,
        status: NODE_STATE.DIRTY,
        isEffect: false,
    }
}
