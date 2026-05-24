import { createSubscriber } from 'svelte/reactivity'
import type { CacheEntry } from '../types/CacheEntry.ts'
import type { CacheStore } from '../types/CacheStore.ts'

/*
Returns a fresh cache store. On the server, every request gets its own
store via the AsyncLocalStorage RequestStore. On the client, a single
module-level store is created at startup and shared across the tab.

Each key gets a lazily-created Svelte subscriber that lives for the
lifetime of the store. Reading a key from a tracking scope
($derived / $effect) subscribes that scope; invalidating the key dispatches
an 'invalidate' event whose detail is a Set of affected keys so each
listener's lookup is O(1). When the entry is later re-created the same
subscriber is reused — no listener churn, no risk of duplicate registrations
during entry eviction. Svelte tears down the underlying listener on its
own when the last tracker stops reading.
*/
export function createCacheStore(): CacheStore {
    const entries = new Map<string, CacheEntry>()
    const events = new EventTarget()
    const subscribers = new Map<string, () => void>()

    function subscribe(key: string): void {
        let registered = subscribers.get(key)
        if (!registered) {
            registered = createSubscriber((update) => {
                const onInvalidate = (event: Event) => {
                    if ((event as CustomEvent<Set<string>>).detail.has(key)) {
                        update()
                    }
                }
                events.addEventListener('invalidate', onInvalidate)
                return () => events.removeEventListener('invalidate', onInvalidate)
            })
            subscribers.set(key, registered)
        }
        registered()
    }

    return { entries, events, subscribe }
}
