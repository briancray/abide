import { setOwnProperty } from '../../shared/setOwnProperty.ts'
import type { Patch } from './types/Patch.ts'

/*
Applies `patch` to `tree` by mutating in place and returns the root (a fresh
value only when the root itself is replaced). In-place is the deliberate choice:
the patch path already names exactly what changed, so we never need copy-on-write
to *detect* a change — and cloning the spine made every leaf write O(width) of
the widest ancestor (a 5k-item list copied 50k times in the bench). Mutating is
O(depth). Change detection is served by announcing patches (the change is a value),
not by retaining old roots — which is cheaper anyway. The wake step in createDoc
force-notifies ancestor readers from the path, since their container keeps its
identity now.

`segments` is the patch path pre-split by the caller (createDoc also needs it),
threaded in so the path is split once per patch rather than here and there.
*/
export function applyPatchToTree(tree: unknown, patch: Patch, segments: string[]): unknown {
    /* Replacing the root can't mutate in place — hand back the new value. */
    if (segments.length === 0) {
        return patch.op === 'remove' ? undefined : patch.value
    }
    let parent = tree as Record<string, unknown>
    for (const segment of segments.slice(0, -1)) {
        /* Only descend into an OWN property. A segment of `__proto__`/`constructor`/
           `prototype` is not own on a plain data object/array, so this refuses to walk
           into a shared prototype (or the constructor function) that a later write would
           then pollute — the real vector, since `apply` is reachable from `sync()` with
           unvalidated peer-controlled patch paths. A legit document key that happens to be
           named `constructor` is an own data property, so `hasOwn` still traverses it. */
        const next = Object.hasOwn(parent, segment) ? parent[segment] : undefined
        if (next === null || typeof next !== 'object') {
            throw new TypeError(
                `abide: patch path segment "${segment}" does not address a container`,
            )
        }
        parent = next as Record<string, unknown>
    }
    const key = segments[segments.length - 1] as string
    if (patch.op === 'replace') {
        setOwnProperty(parent, key, patch.value)
    } else if (patch.op === 'add') {
        if (Array.isArray(parent)) {
            parent.splice(key === '-' ? parent.length : Number(key), 0, patch.value)
        } else {
            setOwnProperty(parent, key, patch.value)
        }
    } else if (Array.isArray(parent)) {
        parent.splice(Number(key), 1)
    } else {
        delete parent[key]
    }
    return tree
}
