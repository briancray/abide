import { cacheStores } from './cacheStores.ts'
import { isSubscribable } from './isSubscribable.ts'
import { selectorMatcher } from './selectorMatcher.ts'
import { selectorPrefix } from './selectorPrefix.ts'
import { tailProbeSlot } from './tailProbeSlot.ts'
import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheSelector } from './types/CacheSelector.ts'
import type { Subscribable } from './types/Subscribable.ts'

/*
Shared scan behind the pending() / refreshing() probes: one selector
interpretation and one tap order — the lifecycle channel is tapped before
any check, so short-circuiting can't skip a subscription and a $derived
re-runs whenever a matching call or stream changes state. The tap is scoped
to the selector: a fn selector taps only its own prefix channel, so reading
`pending(fn)` in an effect can't be re-woken by unrelated cache events (an
effect that probes one fn and invalidates another no longer feeds itself);
bare and scope selectors scan many entries and tap the store-wide channel. A
producer never cached resolves no prefix yet and taps store-wide — its first
cache() marks that channel, the re-derive resolves the prefix, and the scope
re-tracks narrowed. `matchesEntry` is the probe's cache-side question;
`field` selects the stream-side answer; `unprobed` is the answer for a
stream no prober can see (server, or tail never imported) — matching what
tail() itself reports there. The bare form (no selector) spans both
registries; fn/scope selectors are cache identities only. Outside a tracking
scope the taps are no-ops and the current value returns.
*/
export function probeRegistries<Args, Return>(
    arg: CacheSelector<Args, Return> | Subscribable<unknown> | undefined,
    args: Args | undefined,
    field: 'pending' | 'refreshing',
    matchesEntry: (entry: CacheEntry) => boolean,
    unprobed: boolean,
): boolean {
    if (isSubscribable(arg)) {
        return tailProbeSlot.probe?.(arg.name)?.[field] ?? unprobed
    }
    /* fn + args narrows further: the exact key is a one-entry "prefix" (its === branch). */
    const prefix = selectorPrefix(arg, args)
    const stores = cacheStores()
    stores.forEach((store) => {
        store.trackLifecycle(prefix)
    })
    const streams = arg === undefined ? tailProbeSlot.probe?.() : undefined
    const matches = selectorMatcher(arg, args, prefix)
    return (
        stores.some((store) =>
            store.entries.values().some((entry) => matchesEntry(entry) && matches(entry)),
        ) || streams?.[field] === true
    )
}
