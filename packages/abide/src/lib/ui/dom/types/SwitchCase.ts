/* One branch of a `switch`: `match` returns the value this case selects on
   (undefined = the default branch); `render` builds the branch's content into the
   parent (the block tracks it as a range between markers). `pending` (only on an
   async `{#if}`/`{:elseif}` cond-chain branch) reports whether this branch's own
   async condition is still loading — a true reading holds the whole chain here, so a
   later branch never renders on a not-yet-known earlier condition. */
export type SwitchCase = {
    match: (() => unknown) | undefined
    render: (parent: Node) => void
    pending?: () => boolean
}
