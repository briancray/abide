import type { Doc } from '../runtime/types/Doc.ts'
import { readCall } from './readCall.ts'

/*
An in-place-mutating array method lowered on a reactive-document array. The
doc-access lowering rewrites e.g. `model.items.splice(i, 1)` to
`$$mutateDocArray(model, "items", "splice", [i, 1])` rather than the bare
`$$readCall(model.read("items"), …)` it emits for non-mutating calls. The reason:
`read` returns the live tree array by reference, so a bare `.splice()`/`.sort()`/…
would mutate the document in place while never emitting a patch — no reader would
re-render and undo/persistence/multiplayer sync (all keyed off `apply`) would
never see the change (`.push` is the one already-handled exception, lowered to
`add` patches). Cloning the array, applying the mutation to the copy, and writing
it back through `replace` emits a real patch: readers wake and the change is
journalled. Element identity is preserved for untouched entries (a shallow
`slice`), so a keyed `{#for}` reconciles instead of rebuilding. The native
method's return value (spliced-out elements, the new length, …) is returned
unchanged.
*/
// @documentation plumbing
export function mutateDocArray(doc: Doc, path: string, member: string, args: unknown[]): unknown {
    const current = doc.read<unknown>(path)
    /* Not an array — nothing patchable to clone. Fall back to the guarded in-place
       call so the author still gets readCall's authored-scope error message. */
    if (!Array.isArray(current)) {
        return readCall(current, path, member, args)
    }
    const copy = current.slice()
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
