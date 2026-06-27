import type { State } from '../../runtime/types/State.ts'

/* A live row in a keyed list: a content RANGE bounded by two comment markers (so a
   row holds any content, not just one node), plus the disposer for the bindings
   created in its ownership scope. `cell` holds the row's item as a reactive value, so a
   re-key with a changed value (same key, new object) updates the row in place instead of
   leaving it frozen. `indexCell` holds the row's reactive position, so a reorder repaints
   its `index` binding in place without a rebuild. `pending` holds a freshly built row's
   nodes in a fragment until first placement inserts them. */
export type EachRow = {
    start: Node
    end: Node
    dispose: () => void
    cell: State<unknown>
    indexCell: State<number>
    pending?: DocumentFragment
    /* The id of the last reconcile pass that saw this row's key in the source. A row
       whose `gen` lags the current pass departed and is pruned — an int compare that
       replaces a per-reconcile `Set` of present keys. */
    gen?: number
}
