/*
A no-op truthiness marker the router (client) and `renderChain` (SSR) set as a layout's
`$props.children` when a child layer (a nested layout or the page) exists below it. Read
only by `{#if children}` (→ `$props?.children`); a layout's `{children()}` lowers to the
`outlet()` boundary the router fills, so this value is never invoked — it exists purely so
`{#if children}` reads a uniform presence signal on both the client and the server.
*/
export const CHILD_PRESENT = (_host: Element): void => {}
