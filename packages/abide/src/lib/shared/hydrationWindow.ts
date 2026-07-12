import { cacheStores } from './cacheStores.ts'

/*
The one owner of the hydration pass lifecycle — the timing window during which the
client adopts the server-rendered DOM (the router's hydrate branch and `hydrate`).

Why it exists: the server materializes no cache value (materializeRetained/
cacheEntryFromSnapshot are client-only), so server-side peek is uniformly undefined
and the SSR render always shows the fallback. A snapshot-seeded warm value surfacing
DURING hydration would diverge from that server text and corrupt the claimed text
node (assertClaimedText desync), so `peek` withholds it while `active` is true and
`wake()` re-runs the withheld scopes once the pass ends.

`active` is a plain boolean — false on the server (no hydration) and after boot —
readable by the withhold check. `enter`/`exit` bracket a pass with save/restore
nesting (a `depth` counter) so a child hydrate can't clear an outer pass early;
`active` stays true until the OUTERMOST `exit`, which then fires `wake`.

`wake` marks every live cache entry's key: a peek scope taps the exact call key's
lifecycle channel (peek's trackLifecycle), so marking every live entry's key wakes
the scopes that withheld — cheap, one-time, and harmless for non-peek lifecycle
readers (they recompute the same value). Marks by key, not the bare store-wide
channel, because a peek(fn, args) scope taps the per-key prefix channel, which a
keyless mark misses.
*/
export const hydrationWindow = {
    active: false,
    depth: 0,
    /* Open a pass. Nested enters raise the depth without re-firing anything. */
    enter(): void {
        hydrationWindow.depth += 1
        hydrationWindow.active = true
    },
    /* Close a pass. Only the OUTERMOST unwind (depth back to zero) clears `active`
       and wakes the scopes the pass withheld — a nested child exit must not. */
    exit(): void {
        hydrationWindow.depth -= 1
        if (hydrationWindow.depth === 0) {
            hydrationWindow.active = false
            hydrationWindow.wake()
        }
    },
    /* Re-run the peeks the pass withheld, now that the retained value is congruent
       to show. Mark every live entry's key across both cache stores. */
    wake(): void {
        const stores = cacheStores()
        for (const store of stores) {
            for (const key of store.entries.keys()) {
                store.markLifecycle(key)
            }
        }
    },
}
