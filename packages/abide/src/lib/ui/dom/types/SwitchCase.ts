/* One branch of a `switch`: `match` returns the value this case selects on
   (undefined = the default branch); `render` builds the branch's content into the
   parent (the block tracks it as a range between markers). */
export type SwitchCase = {
    match: (() => unknown) | undefined
    render: (parent: Node) => void
}
