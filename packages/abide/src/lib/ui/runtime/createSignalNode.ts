import type { ReactiveNode } from './types/ReactiveNode.ts'

/* Creates a writable leaf node holding `value` with no compute — the source a
   document path or a `state()` cell is backed by. */
export function createSignalNode(value: unknown): ReactiveNode {
    return {
        value,
        compute: undefined,
        deps: new Set(),
        observers: new Set(),
        dirty: false,
        isEffect: false,
    }
}
