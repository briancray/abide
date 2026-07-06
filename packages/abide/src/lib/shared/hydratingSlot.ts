/*
Set true only while the client adopts the server-rendered DOM (the hydration
render pass — see the router's hydrate branch and `hydrate`). Read by `peek`: the
server materializes no cache value (materializeRetained/cacheEntryFromSnapshot are
client-only), so server-side peek is uniformly undefined and the SSR render always
shows the fallback. A snapshot-seeded warm value surfacing DURING hydration would
diverge from that server text and corrupt the claimed text node, so peek withholds
it until the pass ends — `wakeHydrationPeeks` then re-runs the scope on the now-
congruent value. A plain boolean, save/restore-nested so a child hydrate can't clear
an outer pass early; false on the server (no hydration) and after boot.
*/
export const hydratingSlot: { active: boolean } = { active: false }
