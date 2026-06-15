import { trigger } from './trigger.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'

/*
Writes a signal node. An `Object.is`-equal write is a no-op — equality at the
leaf is exactly what stops a no-change patch from waking readers, and (via the
document's structural sharing) what stops an untouched sibling subtree from
re-running when its parent changes identity.
*/
export function writeNode(node: ReactiveNode, value: unknown): void {
    if (Object.is(node.value, value)) {
        return
    }
    node.value = value
    trigger(node)
}
