import { AMEND_TOPIC_PREFIX } from '../shared/AMEND_TOPIC_PREFIX.ts'
import { abideLog } from '../shared/abideLog.ts'
import { cache } from '../shared/cache.ts'
import { SocketDisconnectedError } from '../shared/SocketDisconnectedError.ts'
import type { CacheReaderHook } from '../shared/types/CacheReaderHook.ts'
import type { Socket } from '../shared/types/Socket.ts'
import { socketProxy } from './socketProxy.ts'

/* A cache key is a broadcastable amend target only when it carries cross-client wire
   identity — a remote call key (`METHOD /url…`, per keyForRemoteCall). Producer keys
   (per-process reference ids) and anything else can't be pushed across clients, so we
   never open a subscription for them. */
const REMOTE_KEY = /^(?:GET|POST|PUT|PATCH|DELETE|HEAD) \//

/*
The client-only reactive-reader lifecycle hook (ADR-0043) installed into
cacheReaderSocketSlot by startClient. When a remote key gains its first live reader it
opens a subscription to that call's reserved amend topic and folds each pushed value
into the cache; when the key loses its last reader it closes the subscription — so the
set of subscribed topics stays congruent with the set of keys this tab is reading (and
therefore already authorized for). Refcounted per key so co-readers (or the active/shared
store both reporting a reader) share one subscription.

The channel is live-only (no tail): a value pushed while this tab was disconnected is
missed, so on a transport loss the hook re-opens a fresh live iterator AND refreshes the
key — the ADR-0043 convergence rule, reconciling against authoritative server state
rather than leaving a silently-stale value. `openSocket` is injectable so a test can drive
frames over its own channel without a live ws.
*/
export function createAmendReaderHook(
    openSocket: (name: string) => Socket<unknown> = socketProxy,
): { hook: CacheReaderHook; dispose: () => void } {
    const open = new Map<string, { readers: number; dispose: () => void }>()

    function subscribe(key: string): () => void {
        const socket = openSocket(AMEND_TOPIC_PREFIX + key)
        const controller = new AbortController()
        /* Opening the shared ws channel must never propagate into the cache read that engaged
           this key — a read can't fail because an optional real-time subscription couldn't open
           (e.g. no ws transport). Log and give up on this key's push channel; SWR still holds. */
        let iterator: AsyncIterator<unknown>
        try {
            iterator = socket[Symbol.asyncIterator]()
        } catch (error) {
            abideLog.error(error)
            return () => undefined
        }
        ;(async () => {
            while (!controller.signal.aborted) {
                let next: IteratorResult<unknown>
                try {
                    next = await iterator.next()
                } catch (error) {
                    if (controller.signal.aborted) {
                        return
                    }
                    /* Transport loss: reconcile the possibly-missed value against server truth,
                       then re-open a fresh LIVE subscription (no replay) and keep going. */
                    if (error instanceof SocketDisconnectedError) {
                        cache.refreshMatching((entry) => entry.key === key, key, undefined)
                        try {
                            iterator = socket[Symbol.asyncIterator]()
                        } catch (reopenError) {
                            abideLog.error(reopenError)
                            return
                        }
                        continue
                    }
                    abideLog.error(error)
                    return
                }
                if (controller.signal.aborted || next.done === true) {
                    return
                }
                /* One malformed frame must not tear down the live pipe. Frames come only from the
                   trusted server (clientPublish is false), so this is defense in depth. */
                try {
                    cache.amendByKey(key, next.value)
                } catch (error) {
                    abideLog.error(error)
                }
            }
        })()
        return () => {
            controller.abort()
            iterator.return?.(undefined)?.catch(() => undefined)
        }
    }

    const hook: CacheReaderHook = {
        engage(key) {
            if (!REMOTE_KEY.test(key)) {
                return
            }
            const existing = open.get(key)
            if (existing) {
                existing.readers += 1
                return
            }
            open.set(key, { readers: 1, dispose: subscribe(key) })
        },
        disengage(key) {
            const existing = open.get(key)
            if (existing === undefined) {
                return
            }
            existing.readers -= 1
            if (existing.readers <= 0) {
                existing.dispose()
                open.delete(key)
            }
        },
    }

    /* Tear down every open subscription — for the startClient disposer, in case reads are
       still mounted when the whole client is torn down (e.g. a test harness). */
    function dispose(): void {
        for (const entry of open.values()) {
            entry.dispose()
        }
        open.clear()
    }

    return { hook, dispose }
}
