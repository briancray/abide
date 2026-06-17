/*
The dev live-reload stamp the worker announces on the channel, split so the
browser keeps its page across edits that don't need a reload:
  - `structure` fingerprints everything EXCEPT the entry stylesheet and the
    hot-swappable component bodies — non-component source, public assets, the
    shell, the component-id set, and non-hot component bodies (pages, layouts,
    import-bearing components). Any change here reloads.
  - `cssHref` is the entry stylesheet's current content-hashed URL; a change
    here alone swaps the `<link>` in place. Undefined when no stylesheet is built.
  - `components` maps each hot-swappable (leaf child) component's module id to a
    hash of its client build (style-independent). A change here alone fetches the
    component's hot module and replaces its live instances — no reload.
*/
export type DevReloadStamp = {
    structure: string
    cssHref: string | undefined
    components: Record<string, string>
}
