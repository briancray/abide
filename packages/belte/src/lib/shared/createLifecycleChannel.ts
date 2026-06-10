import { createSubscriber } from 'svelte/reactivity'

/*
Registry-wide lifecycle tap shared by the cache store and the tail registry:
one "membership or state changed" signal for the pending()/refreshing()
probes, which match many entries (or all) and re-derive by scanning, so they
need a single channel rather than per-key granularity. track() inside a
tracking scope ($derived / $effect) re-runs that scope on every mark();
outside one it is a no-op. The subscriber is created lazily on the first
tracked read and self-evicts when its last reader tears down,
identity-guarded so a concurrent re-track isn't clobbered. mark() is a plain
callback — the channel only ever has the one memoized listener, so no
EventTarget dispatch is needed.
*/
export function createLifecycleChannel(): { track: () => void; mark: () => void } {
    let notify: (() => void) | undefined
    let tracker: (() => void) | undefined
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
                    }
                })
                tracker = created
            }
            tracker()
        },
        mark() {
            notify?.()
        },
    }
}
