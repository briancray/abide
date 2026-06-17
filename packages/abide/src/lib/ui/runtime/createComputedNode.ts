import type { ReactiveNode } from './types/ReactiveNode.ts'

/* Creates a lazy derived node. Born dirty so its first read computes; thereafter
   it recomputes only when a dependency triggers it. */
export function createComputedNode(compute: () => unknown): ReactiveNode {
    return {
        value: undefined,
        compute,
        depsHead: undefined,
        depsTail: undefined,
        subsHead: undefined,
        subsTail: undefined,
        dirty: true,
        isEffect: false,
    }
}
