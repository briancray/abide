/*
The dev live-reload stamp the worker announces on the channel, split so the
browser keeps its page across edits that don't need a reload:
  - `structure` fingerprints every source signal a reload must react to — each
    `.abide`'s client build hash (no CSS), the component-id set, non-`.abide`
    source, public assets, and the shell (with the stylesheet href normalised out).
    Any change here reloads.
  - `cssHref` is the entry stylesheet's current content-hashed URL; a change here
    alone swaps the `<link>` in place. Undefined when no stylesheet is built.
*/
export type DevReloadStamp = {
    structure: string
    cssHref: string | undefined
}
