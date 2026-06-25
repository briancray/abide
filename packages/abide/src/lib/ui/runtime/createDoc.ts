import { applyPatchToTree } from './applyPatchToTree.ts'
import { batch } from './batch.ts'
import { createComputedNode } from './createComputedNode.ts'
import { createSignalNode } from './createSignalNode.ts'
import { PATCH_BUS } from './PATCH_BUS.ts'
import { pathSegments } from './pathSegments.ts'
import { readNode } from './readNode.ts'
import { trigger } from './trigger.ts'
import type { Cell } from './types/Cell.ts'
import type { Doc } from './types/Doc.ts'
import type { Patch } from './types/Patch.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'
import { walkPath } from './walkPath.ts'
import { writeNode } from './writeNode.ts'

/* `path` minus its last segment — the parent container's path, '' at the root.
   The same string `segments.slice(0, -1).join('/')` rebuilds, by one slice. */
function parentPathOf(path: string): string {
    const lastSlash = path.lastIndexOf('/')
    return lastSlash === -1 ? '' : path.slice(0, lastSlash)
}

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
    /* Computed slots: a path whose value is a function of other paths, not stored
       truth. Held apart from `nodes` so the structural wake/eviction never touches
       them; their dirtiness is driven entirely by the deps they read (the signal
       graph), not by tree mutations. They are not in `tree`, so `snapshot` omits
       them, and they never pass through `apply`, so they never hit the patch bus —
       a recompute is a downstream reaction, not a change to journal/persist/sync. */
    const computed = new Map<string, ReactiveNode>()
    /* Set to the returned document before any apply runs, so a PATCH_BUS event can
       name the document it came from (reference identity, the undo/persistence key). */
    let self: Doc

    function nodeFor(path: string): ReactiveNode {
        let node = nodes.get(path)
        if (node === undefined) {
            node = createSignalNode(walkPath(tree, path).value)
            nodes.set(path, node)
        }
        return node
    }

    function read<T>(path: string): T {
        /* Size-gated so a doc with no computed slots pays nothing on the stored hot
           path — only one `.size` check, not a `.get` per read. */
        if (computed.size > 0) {
            const computedNode = computed.get(path)
            if (computedNode !== undefined) {
                return readNode(computedNode) as T
            }
        }
        return readNode(nodeFor(path)) as T
    }

    /* Registers a computed slot at `path` and returns a string-free reader bound to
       its node — the hoisted accessor the compiler would emit (the `computed` form),
       so a hot read skips the path lookup. Reading the compute subscribes it to
       whatever doc paths it touches; those deps then drive its recomputation. */
    function derive<T>(path: string, compute: () => T): () => T {
        const node = createComputedNode(compute as () => unknown)
        computed.set(path, node)
        return () => readNode(node) as T
    }

    /*
    Wakes readers from `rootPath`. `force` notifies the root unconditionally (a
    structural change keeps the container's identity, so there is no new value to
    compare); otherwise the root is written through the `Object.is` gate. When
    `descend`, a container root also re-reads its existing descendant nodes (gated)
    to catch nested and index-shifted values. `descend` is skipped for a change
    that leaves every existing descendant path addressing the same value (an
    end-append or an object-key add), so those updates stay O(depth) instead of
    paying a scan over every minted node.
    */
    function wakeSubtree(rootPath: string, force: boolean, descend: boolean): void {
        const rootValue = walkPath(tree, rootPath).value
        const rootNode = nodes.get(rootPath)
        if (rootNode !== undefined) {
            if (force) {
                trigger(rootNode)
            } else {
                writeNode(rootNode, rootValue)
            }
        }
        if (!descend || rootValue === null || typeof rootValue !== 'object') {
            return
        }
        const prefix = rootPath === '' ? '' : `${rootPath}/`
        for (const [candidate, node] of nodes) {
            if (candidate !== rootPath && candidate.startsWith(prefix)) {
                /* A descendant whose path the mutation removed — a deleted key, an
                   out-of-range index after a shrink — is woken to undefined, then
                   dropped from the registry. Without eviction `nodes` grows for the
                   life of the session over churning keys (items/<uuid>, message ids),
                   and this very descend scan degrades linearly with it. The woken
                   reader re-mints a fresh node on its flush if the path ever returns.
                   Deleting the current entry mid-iteration is safe on a Map. */
                const walk = walkPath(tree, candidate)
                if (walk.exists) {
                    writeNode(node, walk.value)
                } else {
                    writeNode(node, undefined)
                    nodes.delete(candidate)
                }
            }
        }
    }

    function apply(patch: Patch): void {
        /* Segments index the tree, so they carry the REAL keys (unescaped); the path
           strings (parentPath, node-map keys) stay escaped, re-walked through walkPath. */
        const segments = patch.path === '' ? [] : pathSegments(patch.path)
        /* Capture the pre-image only when a consumer is listening (the inverse's only
           cost): a replace/remove inverts to the value it overwrote, an add to a
           remove (computed post-apply, below, to resolve an array append's index). */
        const before = PATCH_BUS.active ? walkPath(tree, patch.path) : undefined
        tree = applyPatchToTree(tree, patch, segments)
        const parentPath = parentPathOf(patch.path)
        const parentValue = walkPath(tree, parentPath).value
        const leafKey = segments[segments.length - 1] as string | undefined
        /* A structural change (add/remove, or an array element replaced by index)
           reshapes the parent; a plain value replace reshapes only its own path. */
        const parentIsArray = Array.isArray(parentValue)
        const structural = patch.op !== 'replace' || parentIsArray
        const arrayLength = parentIsArray ? (parentValue as unknown[]).length : 0
        /* An add that introduces a new path without shifting any existing sibling —
           an object-key add or an array append at the end — changes only the added
           slot's subtree plus (for an array) its `length` node, never the existing
           element nodes. Waking exactly those two avoids re-reading every descendant
           of a large container. Every other structural change (any remove, a
           mid-array insert, an array element replace) shifts indices or replaces a
           subtree, so all descendants must be re-read. */
        const nonShiftingAdd =
            patch.op === 'add' &&
            (!parentIsArray || leafKey === '-' || Number(leafKey) === arrayLength - 1)
        batch(() => {
            if (segments.length === 0) {
                wakeSubtree('', true, true)
            } else if (!structural) {
                wakeSubtree(patch.path, false, true)
            } else if (nonShiftingAdd) {
                wakeSubtree(parentPath, true, false)
                /* The appended slot resolves to its real index when keyed by `-`. */
                const addedPath =
                    parentIsArray && leafKey === '-'
                        ? `${parentPath}/${arrayLength - 1}`
                        : patch.path
                wakeSubtree(addedPath, false, true)
                const lengthNode = parentIsArray ? nodes.get(`${parentPath}/length`) : undefined
                if (lengthNode !== undefined) {
                    writeNode(lengthNode, arrayLength)
                }
            } else {
                wakeSubtree(parentPath, true, true)
            }
            /* Announce the change before effects flush, so a patch an effect emits in
               reaction lands AFTER this one on the bus — the journal stays chronological.
               Emitting inside the batch keeps it ahead of the depth-0 flush on batch exit. */
            if (PATCH_BUS.active) {
                PATCH_BUS.emit({ doc: self, patch, inverse: inverseOf(patch, before) })
            }
        })
    }

    /* The patch that undoes `patch`, from the pre-image `before` (a value the change
       overwrote/removed) and the now-mutated tree. An add inverts to removing the slot
       it created — resolving an array append (`-`) to the concrete last index it took.
       A replace/remove of a path that held nothing inverts to remove/nothing. */
    function inverseOf(
        patch: Patch,
        before: ReturnType<typeof walkPath> | undefined,
    ): Patch | undefined {
        if (patch.op === 'add') {
            const parentPath = parentPathOf(patch.path)
            const parent = walkPath(tree, parentPath).value
            const resolved =
                Array.isArray(parent) && patch.path.endsWith('/-')
                    ? `${parentPath}/${parent.length - 1}`
                    : patch.path
            return { op: 'remove', path: resolved }
        }
        if (patch.op === 'replace') {
            return before?.exists
                ? { op: 'replace', path: patch.path, value: before.value }
                : { op: 'remove', path: patch.path }
        }
        return before?.exists ? { op: 'add', path: patch.path, value: before.value } : undefined
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
        const segments = pathSegments(path)
        const leafKey = segments[segments.length - 1] as string
        /* Auto-vivify missing ancestor objects so binding a nested path on a doc
           booted shallow (e.g. `state({})`) doesn't crash, and a later `set` writes
           into the LIVE tree (so snapshot/persist see it). Mirrors the container
           assumption applyPatchToTree makes — except the patch path is authored, this
           walk is compiler-emitted, so the intermediates may not exist yet. */
        let parent = tree as Record<string, unknown>
        for (const segment of segments.slice(0, -1)) {
            let next = parent[segment]
            if (next === null || typeof next !== 'object') {
                next = {}
                parent[segment] = next
            }
            parent = next as Record<string, unknown>
        }
        return {
            get: () => readNode(node) as T,
            set: (value: T) => {
                parent[leafKey] = value
                writeNode(node, value)
            },
        }
    }

    self = {
        read,
        cell,
        derive,
        apply,
        replace: (path, value) => apply({ op: 'replace', path, value }),
        add: (path, value) => apply({ op: 'add', path, value }),
        remove: (path) => apply({ op: 'remove', path }),
        snapshot: () => tree,
    }
    return self
}
