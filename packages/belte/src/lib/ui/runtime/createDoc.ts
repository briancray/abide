import { applyPatchToTree } from './applyPatchToTree.ts'
import { createSignalNode } from './createSignalNode.ts'
import { flushEffects } from './flushEffects.ts'
import { REACTIVE_CONTEXT } from './REACTIVE_CONTEXT.ts'
import { readNode } from './readNode.ts'
import { trigger } from './trigger.ts'
import type { Cell } from './types/Cell.ts'
import type { Doc } from './types/Doc.ts'
import type { Patch } from './types/Patch.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'
import { valueAtPath } from './valueAtPath.ts'
import { writeNode } from './writeNode.ts'

/*
Builds a reactive document over `initial`. Each path read for the first time
mints a signal node; the node is the notification token, the (mutable) tree is
the source of truth. A patch mutates the tree in place — O(depth), not O(width) —
then wakes from the patch's **change root** with shape-only reactivity:

  - a value change at a path (an object key replaced with a new value) wakes only
    that path and, if it became a container, its descendants — NOT its ancestors.
    Reading a container subscribes to its own shape, so a deep field change never
    re-runs a reader of the array/object above it (the reason a single list-item
    edit doesn't reconcile the whole `each`).
  - a structural change (add/remove anywhere, or replacing an array element by
    index) changes the *parent container's* shape, so the parent is the change
    root: it is force-notified (its identity is unchanged after in-place mutation)
    and its descendants are re-read to pick up index shifts.

Reads of exactly the changed path are gated by `Object.is`, so an equal write
wakes nobody. Change is addressed, not diffed, and the address is as shallow as
the change.
*/
export function createDoc(initial: unknown): Doc {
    let tree = initial
    const nodes = new Map<string, ReactiveNode>()

    function nodeFor(path: string): ReactiveNode {
        let node = nodes.get(path)
        if (node === undefined) {
            node = createSignalNode(valueAtPath(tree, path))
            nodes.set(path, node)
        }
        return node
    }

    function read<T>(path: string): T {
        return readNode(nodeFor(path)) as T
    }

    /*
    Wakes readers from `rootPath`. `force` notifies the root unconditionally (a
    structural change keeps the container's identity, so there is no new value to
    compare); otherwise the root is written through the `Object.is` gate. A
    container root re-reads its existing descendant nodes (also gated) to catch
    nested and index-shifted values; a scalar root has none, so leaf updates stay
    O(depth).
    */
    function wakeSubtree(rootPath: string, force: boolean): void {
        const rootValue = valueAtPath(tree, rootPath)
        const rootNode = nodes.get(rootPath)
        if (rootNode !== undefined) {
            if (force) {
                trigger(rootNode)
            } else {
                writeNode(rootNode, rootValue)
            }
        }
        if (rootValue === null || typeof rootValue !== 'object') {
            return
        }
        const prefix = rootPath === '' ? '' : `${rootPath}/`
        for (const [candidate, node] of nodes) {
            if (candidate !== rootPath && candidate.startsWith(prefix)) {
                writeNode(node, valueAtPath(tree, candidate))
            }
        }
    }

    function apply(patch: Patch): void {
        const segments = patch.path === '' ? [] : patch.path.split('/')
        tree = applyPatchToTree(tree, patch)
        const parentPath = segments.slice(0, -1).join('/')
        /* A structural change (add/remove, or an array element replaced by index)
           reshapes the parent; a plain value replace reshapes only its own path. */
        const parentIsArray = Array.isArray(valueAtPath(tree, parentPath))
        const structural = patch.op !== 'replace' || parentIsArray
        REACTIVE_CONTEXT.batchDepth += 1
        try {
            if (segments.length === 0) {
                wakeSubtree('', true)
            } else if (structural) {
                wakeSubtree(parentPath, true)
            } else {
                wakeSubtree(patch.path, false)
            }
        } finally {
            REACTIVE_CONTEXT.batchDepth -= 1
        }
        flushEffects()
    }

    /*
    A stable accessor bound to one scalar leaf — what the compiler emits so a hot
    loop has zero string work: the node, the parent container, and the leaf key
    are resolved once. `set` mutates the parent directly and writes the node
    through the gate; no ancestor walk, because a scalar leaf change is shape-only
    (it never reshapes its container). Valid while ancestors keep their identity
    (the scalar-field case); a wholesale ancestor replace re-binds the cell.
    */
    function cell<T>(path: string): Cell<T> {
        const node = nodeFor(path)
        const segments = path.split('/')
        const leafKey = segments[segments.length - 1] as string
        let parent = tree as Record<string, unknown>
        for (const segment of segments.slice(0, -1)) {
            parent = parent[segment] as Record<string, unknown>
        }
        return {
            get: () => readNode(node) as T,
            set: (value: T) => {
                parent[leafKey] = value
                writeNode(node, value)
            },
        }
    }

    return {
        read,
        cell,
        apply,
        replace: (path, value) => apply({ op: 'replace', path, value }),
        add: (path, value) => apply({ op: 'add', path, value }),
        remove: (path) => apply({ op: 'remove', path }),
        snapshot: () => tree,
    }
}
