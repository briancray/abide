import { NODE_STATE } from './NODE_STATE.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'

/* Creates a writable leaf node holding `value` with no compute — the source a
   document path or a `state()` cell is backed by. Always CLEAN: a signal has no
   dependencies to settle; its value is whatever was last written. */
export function createSignalNode(value: unknown): ReactiveNode {
    return {
        value,
        compute: undefined,
        depsHead: undefined,
        depsTail: undefined,
        subsHead: undefined,
        subsTail: undefined,
        status: NODE_STATE.CLEAN,
        isEffect: false,
    }
}
