import { createDoc } from './runtime/createDoc.ts'
import type { Doc } from './runtime/types/Doc.ts'

/*
Creates a reactive document: a single immutable, serializable tree addressed by
path, where every change is a patch. `doc.read(path)` is path-granular reactive
read; `doc.replace/add/remove` emit patches that wake only the readers whose
paths the change touched. This is the substrate the whole framework stands on —
deep reactivity, resumability, undo, and sync all reduce to "a patch over a
path", so they share one mechanism instead of being bolted on.
*/
// @readme plumbing
export function doc(initial: unknown = {}): Doc {
    return createDoc(initial)
}
