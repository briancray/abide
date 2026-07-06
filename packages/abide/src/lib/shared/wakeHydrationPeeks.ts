import { cacheStores } from './cacheStores.ts'

/*
Fired once when the outermost hydration pass ends (see the router's hydrate branch
and `hydrate`). During the pass `peek` withheld every snapshot-seeded warm value
for SSR congruence (see hydratingSlot); now that the pass is over those values are
congruent to show, so re-run the scopes that read them. A peek scope taps the exact
call key's lifecycle channel (peek's trackLifecycle), so marking every live entry's
key wakes them — cheap, one-time, and harmless for non-peek lifecycle readers (they
recompute the same value). Marks by key, not the bare store-wide channel, because a
peek(fn, args) scope taps the per-key prefix channel, which a keyless mark misses.
*/
export function wakeHydrationPeeks(): void {
    const stores = cacheStores()
    for (const store of stores) {
        for (const key of store.entries.keys()) {
            store.markLifecycle(key)
        }
    }
}
