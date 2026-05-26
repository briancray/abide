import { createSubscriber } from 'svelte/reactivity'
import type { Subscribable } from '../shared/types/Subscribable.ts'

type SubscriptionStatus = 'pending' | 'open' | 'done' | 'error'

type Entry<T> = {
    latest: T | undefined
    error: Error | undefined
    status: SubscriptionStatus
    tap: () => void
}

const registry = new Map<string, Entry<unknown>>()

/*
Reactive consumer for streaming sources. Takes a Subscribable<T> — the
shape both `Socket<T>` (declared under src/server/sockets/) and the result of
`fn.stream(args)` satisfy:

  const latest = $derived(subscribe(chat))                  // socket
  const latest = $derived(subscribe(tickFeed.stream()))     // rpc stream (no args)
  const latest = $derived(subscribe(countLog.stream({ to: 5 })))  // rpc stream

Lifecycle mirrors cache(): the entry's tracker is a Svelte
createSubscriber, so the first $derived read in a tracking scope opens
the underlying iterator (with history replay on a Socket, or a fresh
fetch on an rpc stream), and the last $derived to stop reading closes
it. Many $deriveds reading the same source share one underlying
subscription — the registry dedupes by `subscribable.name`, which is
the socket name for declared sockets and `keyForRemoteCall(method, url,
args)` for rpc streams. So passing fresh `fn.stream(args)` Subscribables
across re-renders is safe: same args → same key → shared subscription.

Subscribe is a no-op on the server (returns undefined) — SSR can't
keep a stream open across the request boundary. Pages that want a
seeded value in the initial HTML should fetch via cache() against an
HTTP rpc handler and layer subscribe() on top for live updates after
hydration.

Errors are surfaced through subscribe.error(x) rather than thrown, so
reading `latest` from a $derived can't crash the component. Status
distinguishes "haven't received the first frame" (pending) from
"stream ended cleanly" (done) and "wire layer surfaced an error"
(error).
*/
export function subscribe<T>(subscribable: Subscribable<T>): T | undefined {
    return readField(subscribable, 'latest') as T | undefined
}

subscribe.error = function subscribeError<T>(subscribable: Subscribable<T>): Error | undefined {
    return readField(subscribable, 'error') as Error | undefined
}

subscribe.status = function subscribeStatus<T>(subscribable: Subscribable<T>): SubscriptionStatus {
    return (readField(subscribable, 'status') as SubscriptionStatus | undefined) ?? 'pending'
}

function readField<T, K extends keyof Entry<T>>(
    subscribable: Subscribable<T>,
    field: K,
): Entry<T>[K] | undefined {
    if (typeof window === 'undefined') {
        if (field === 'status') {
            return 'pending' as Entry<T>[K]
        }
        return undefined
    }
    const entry = getOrCreateEntry(subscribable) as Entry<T>
    entry.tap()
    return entry[field]
}

function getOrCreateEntry<T>(subscribable: Subscribable<T>): Entry<T> {
    const key = subscribable.name
    const cached = registry.get(key) as Entry<T> | undefined
    if (cached) {
        return cached
    }
    const entry: Entry<T> = {
        latest: undefined,
        error: undefined,
        status: 'pending',
        tap: () => undefined,
    }
    entry.tap = createSubscriber((update) => {
        entry.latest = undefined
        entry.error = undefined
        entry.status = 'pending'
        const iterator = subscribable[Symbol.asyncIterator]()
        let cancelled = false
        ;(async () => {
            try {
                while (!cancelled) {
                    const next = await iterator.next()
                    if (next.done) {
                        if (!cancelled) {
                            if (entry.status !== 'error') {
                                entry.status = 'done'
                            }
                            update()
                        }
                        return
                    }
                    entry.latest = next.value
                    entry.status = 'open'
                    update()
                }
            } catch (error) {
                if (!cancelled) {
                    entry.error = error instanceof Error ? error : new Error(String(error))
                    entry.status = 'error'
                    update()
                }
            }
        })()
        return () => {
            cancelled = true
            iterator.return?.(undefined)?.catch(() => undefined)
            registry.delete(key)
        }
    })
    registry.set(key, entry as Entry<unknown>)
    return entry
}
