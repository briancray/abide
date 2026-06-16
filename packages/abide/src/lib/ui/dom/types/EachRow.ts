/* A live row in a keyed list: its top node (for placement/removal) and the
   disposer for the bindings created in its ownership scope. */
export type EachRow = { node: Node; dispose: () => void }
