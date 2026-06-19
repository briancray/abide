import type { Doc } from './Doc.ts'
import type { Patch } from './Patch.ts'

/*
A single applied change announced on the `PATCH_BUS`: the `doc` it hit (reference
identity within the process — a serialization-stable id arrives with sync), the
forward `patch`, and its `inverse` — the patch that exactly undoes it, or
`undefined` for a no-op (e.g. removing an absent key). Consumers — undo history,
persistence, sync — read this one shape; the inverse is what makes a journal
reversible at O(size of the change), never a retained tree snapshot.
*/
export type PatchEvent = {
    doc: Doc
    patch: Patch
    inverse: Patch | undefined
}
