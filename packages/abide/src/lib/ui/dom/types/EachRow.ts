/* A live row in a keyed list: a content RANGE bounded by two comment markers (so a
   row holds any content, not just one node), plus the disposer for the bindings
   created in its ownership scope. `pending` holds a freshly built row's nodes in a
   fragment until first placement inserts them. */
export type EachRow = {
    start: Node
    end: Node
    dispose: () => void
    pending?: DocumentFragment
}
