/* One branch of a `switch`: `match` returns the value this case selects on
   (undefined = the default branch); `render` builds the branch's element roots. */
export type SwitchCase = {
    match: (() => unknown) | undefined
    render: (parent: Node) => Node[]
}
