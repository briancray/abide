/*
Opt-in hook that lets an external reactive resource (e.g. `belte/shared/cache`)
make a belte-ui read tracked — WITHOUT the belte-ui core importing that resource
(which would drag its dependencies, including `svelte/reactivity`, into every
bundle that uses an await block). `trackRead` runs the read, registers whatever
the enclosing belte-ui effect should depend on so a later invalidation re-runs
it, and returns the read's result.

Unset by default: reads run plain and never re-run on an external invalidation.
`installCacheReactivity()` sets it to a cache-aware capture; nothing else does, so
apps that never wire cache reactivity pay nothing (no import, no runtime cost).
*/
export const REACTIVE_BRIDGE: { trackRead?: <T>(read: () => T) => T } = {}
