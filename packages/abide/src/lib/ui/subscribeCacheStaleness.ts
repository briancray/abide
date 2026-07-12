import { abideLog } from '../shared/abideLog.ts'
import { CACHE_STALENESS_SOCKET } from '../shared/CACHE_STALENESS_SOCKET.ts'
import { cache } from '../shared/cache.ts'
import { matcherFromEnvelope } from '../shared/matcherFromEnvelope.ts'
import { SocketDisconnectedError } from '../shared/SocketDisconnectedError.ts'
import type { CacheStalenessFrame } from '../shared/types/CacheStalenessFrame.ts'
import type { Socket } from '../shared/types/Socket.ts'
import { socketProxy } from './socketProxy.ts'

/*
The client half of the cross-client staleness broadcast (ADR-0041): every tab
subscribes to the reserved __abide/cache socket at boot and applies each frame to
its own cache. A frame rebuilds the entry predicate via matcherFromEnvelope and
drives the SAME store loop a local invalidate()/refresh() does
(cache.invalidateMatching / cache.refreshMatching), so wire-driven and local applies
can't diverge.

LIVE-ONLY, never replay: bare iteration (replay 0) on both boot and reconnect — a
client applies only frames published while it is connected. The reserved topic keeps
no tail, so there is nothing to catch up on; a client offline when a frame was
published misses it and falls back to SWR staleness. Applies are idempotent, so
correctness has no dependency on frame ordering.

No-op on the server (no window): the broadcast is the server's job, not something it
consumes. Returns a disposer that stops the loop and closes the subscription.
*/
export function subscribeCacheStaleness(injectedSocket?: Socket<CacheStalenessFrame>): () => void {
    if (typeof window === 'undefined') {
        return () => undefined
    }
    /* Default to the browser channel proxy; tests inject a socket over their own channel. */
    const socket = injectedSocket ?? socketProxy<CacheStalenessFrame>(CACHE_STALENESS_SOCKET)
    const controller = new AbortController()
    /* `let`: a reconnect swaps in a fresh live iterator after a transport loss. */
    let iterator = socket[Symbol.asyncIterator]()
    ;(async () => {
        while (!controller.signal.aborted) {
            let next: IteratorResult<CacheStalenessFrame>
            try {
                next = await iterator.next()
            } catch (error) {
                if (controller.signal.aborted) {
                    return
                }
                /* Transport loss: re-open a fresh LIVE subscription (no replay) and keep going. */
                if (error instanceof SocketDisconnectedError) {
                    iterator = socket[Symbol.asyncIterator]()
                    continue
                }
                abideLog.error(error)
                return
            }
            if (controller.signal.aborted || next.done === true) {
                return
            }
            /* One malformed frame must not tear down the live pipe: a throw from decode/apply
               is logged and swallowed so every subsequent frame still delivers. Frames come
               only from the trusted server (clientPublish is false), so this is defense in
               depth, not an expected path. */
            try {
                applyFrame(next.value)
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

/* Applies one decoded frame to this tab's cache via the shared apply-by-matcher seam. */
function applyFrame(frame: CacheStalenessFrame): void {
    const matches = matcherFromEnvelope(frame)
    /* The tripwire label + the rpc-error-registry prefix, mirroring what a local selector
       derives: a tag frame has no key prefix to clear. */
    const label = frame.mode === 'tags' ? `tags: ${frame.tags.join(', ')}` : frame.match
    const prefix = frame.mode === 'tags' ? undefined : frame.match
    if (frame.op === 'invalidate') {
        cache.invalidateMatching(matches, label, prefix)
    } else {
        cache.refreshMatching(matches, label, prefix)
    }
}
