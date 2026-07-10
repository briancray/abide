import { createSubscriber } from './createSubscriber.ts'

/*
Lifecycle tap shared by the cache store and the tail registry: one
"membership or state changed" signal for the pending()/refreshing() probes,
which match a group of entries and re-derive by scanning. The owning
registry decides the granularity — the cache store keeps a store-wide
channel plus one per probed selector prefix; this module only owns the
subscribe/notify semantics. track() inside a
tracking scope ($derived / $effect) re-runs that scope on every mark();
outside one it is a no-op. The subscriber is created lazily on the first
tracked read and self-evicts when its last reader tears down,
identity-guarded so a concurrent re-track isn't clobbered. mark() is a plain
callback — the channel only ever has the one memoized listener, so no
EventTarget dispatch is needed.

mark() defers its notify to a microtask: registry mutations happen inside
consumer read paths, and the documented read idiom is `$derived(await
cache(fn)())` — a cold read there registers an entry mid-derived, where
writing the subscriber's version source throws state_unsafe_mutation. The
probes scan the registry at re-derive time, so a deferred ping reads state
that is already current; marks within one tick coalesce into one notify.
*/
export function createLifecycleChannel(onIdle?: () => void): {
    track: () => void
    mark: () => void
} {
    let notify: (() => void) | undefined
    let tracker: (() => void) | undefined
    let marked = false
    return {
        track() {
            if (!tracker) {
                const created = createSubscriber((update) => {
                    notify = update
                    return () => {
                        notify = undefined
                        if (tracker === created) {
                            tracker = undefined
                        }
                        /* Last reader torn down — let an owner (the cache store's per-prefix map)
                           evict this now-inert channel instead of retaining it for the tab's life. */
                        onIdle?.()
                    }
                })
                tracker = created
            }
            tracker()
        },
        mark() {
            if (notify === undefined || marked) {
                return
            }
            marked = true
            queueMicrotask(() => {
                marked = false
                /* Re-read: the last reader may have torn down during the deferral. */
                notify?.()
            })
        },
    }
}
