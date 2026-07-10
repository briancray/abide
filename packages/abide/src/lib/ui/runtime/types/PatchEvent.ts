import type { Doc } from './Doc.ts'
import type { Patch } from './Patch.ts'

/*
A single applied change announced on the `PATCH_BUS`: the `doc` it hit (reference
identity within the process) and the forward `patch`. Consumers (the inspector's
change feed, a component's model-doc capture) read this one shape.
*/
export type PatchEvent = {
    doc: Doc
    patch: Patch
}
