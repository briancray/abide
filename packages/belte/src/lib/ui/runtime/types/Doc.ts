import type { Cell } from './Cell.ts'
import type { Patch } from './Patch.ts'

/*
A reactive document: a single immutable tree addressed by path. `read` subscribes
the running observer to a path and returns its current value; `apply` (and the
`replace`/`add`/`remove` sugar) advances the tree by one patch and wakes exactly
the readers whose paths the patch touched. `snapshot` returns the current root —
plain, serializable data, which is what makes the document resumable.
*/
export type Doc = {
    read: <T>(path: string) => T
    cell: <T>(path: string) => Cell<T>
    apply: (patch: Patch) => void
    replace: (path: string, value: unknown) => void
    add: (path: string, value: unknown) => void
    remove: (path: string) => void
    snapshot: () => unknown
}
