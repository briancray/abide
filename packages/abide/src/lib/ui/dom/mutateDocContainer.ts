import type { Doc } from '../runtime/types/Doc.ts'
import { readCall } from './readCall.ts'

/*
An in-place-mutating container method lowered on a reactive-document value. The
doc-access lowering rewrites e.g. `model.items.splice(i, 1)` to
`$$mutateDocContainer(model, "items", "splice", [i, 1])` rather than the bare
`$$readCall(model.read("items"), …)` it emits for non-mutating calls. The reason:
`read` returns the live tree value by reference, so a bare `.splice()`/`.sort()`/
`.add()`/`.set()`/… would mutate the document in place while never emitting a
patch — so no reader would re-render (`.push` is the one already-handled exception,
lowered to `add` patches). Cloning the container, applying the mutation to the copy,
and writing it back through `replace` emits a real patch: readers wake.

Covers the three mutable containers the doc codec serializes (encodeRefJson):
Array (cloned by `slice`), Map (`new Map`) and Set (`new Set`) — the mutating
method names are disjoint across the three (`pop`/`splice`/… vs `add`/`set`/…), so
the caller routes them all here and the actual kind is decided at runtime by the
value's type, no compile-time check needed. Element identity is preserved for
untouched entries (a shallow copy), so a keyed `{#for}` reconciles instead of
rebuilding. The native method's return value (spliced-out elements, the new
length, the deleted flag, …) is returned unchanged.
*/
// @documentation plumbing
export function mutateDocContainer(
    doc: Doc,
    path: string,
    member: string,
    args: unknown[],
): unknown {
    const current = doc.read<unknown>(path)
    const copy = cloneContainer(current)
    /* Not a container we clone (array/Map/Set) — fall back to the guarded in-place call so
       the author still gets readCall's authored-scope error message (a plain doc object has
       no methods, so this is the same throw the bare call would raise). */
    if (copy === undefined) {
        return readCall(current, path, member, args)
    }
    const method = (copy as unknown as Record<string, unknown>)[member]
    if (typeof method !== 'function') {
        throw new TypeError(
            `abide: cannot call .${member}() — "${path}".${member} is not a function (got ${typeof method})`,
        )
    }
    const returned = (method as (...callArgs: unknown[]) => unknown).apply(copy, args)
    doc.replace(path, copy)
    return returned
}

/* A shallow clone of a mutable doc container, or undefined when the value is not one — the
   shallow copy preserves element/entry identity so keyed reconciliation survives the patch. */
function cloneContainer(
    current: unknown,
): unknown[] | Map<unknown, unknown> | Set<unknown> | undefined {
    if (Array.isArray(current)) {
        return current.slice()
    }
    if (current instanceof Map) {
        return new Map(current)
    }
    if (current instanceof Set) {
        return new Set(current)
    }
    return undefined
}
