import type { Socket } from '../server/sockets/types/Socket.ts'
import { browserClientFlags } from './browserClientFlags.ts'
import { createPushIterator } from './createPushIterator.ts'
import { SOCKETS_PATH } from './SOCKETS_PATH.ts'
import type { SocketChannel } from './types/SocketChannel.ts'
import type { TailHooks } from './types/TailHooks.ts'
import { withBase } from './withBase.ts'

/* Per-channel-agnostic sub id counter; uniqueness within a channel is all the
   lifecycle routing needs, so one monotonic source across every socket is fine. */
let nextId = 0

/*
Builds a Socket<T> over a SocketChannel — the one Socket surface every consumer
side shares, so the browser proxy and the test harness can't drift on the
Socket contract or the iterator wiring. `resolveChannel` is a thunk, called on
first subscribe/publish rather than at construction, so the bundler's one
socketProxy() per socket doesn't open a ws until the socket is actually read.

Bare iteration is the live stream (replay 0); `.tail(n)` seeds from the
retained tail (no-arg = the whole tail). Each iterator mints its own sub id for
lifecycle routing (end/err), and `hooks.replayed` fires in-band after the
replay batch so a window reader commits its seed strictly before any live frame.
*/
export function buildSocketOverChannel<T>(
    name: string,
    resolveChannel: () => SocketChannel,
): Socket<T> {
    /* The latest frame seen across every iterator of this socket — what peek() returns and
       what refresh() re-seeds from the server tail. A plain slot (not reactive): peek(socket)
       is a synchronous snapshot; live reactivity is the for-await / watch(socket) path. */
    let lastFrame: T | undefined
    function iterate(replay: number | undefined, hooks?: TailHooks): AsyncIterable<T> {
        return {
            [Symbol.asyncIterator](): AsyncIterator<T, void, undefined> {
                const id = `s${++nextId}`
                const channel = resolveChannel()
                const iterator = createPushIterator<T>(() => channel.unsubscribe(id))
                channel.subscribe(id, name, replay, {
                    onMessage: (value) => {
                        lastFrame = value as T
                        iterator.push(value as T)
                    },
                    onReplay: (messages) => {
                        for (const value of messages) {
                            lastFrame = value as T
                            iterator.push(value as T)
                        }
                        if (hooks?.replayed) {
                            iterator.control(hooks.replayed)
                        }
                    },
                    onEnd: () => iterator.end(),
                    onError: (message) => iterator.error(message),
                    onDisconnect: () => iterator.disconnect(),
                })
                return iterator
            },
        }
    }
    const publish = (message: T) => resolveChannel().publish(name, message)
    return {
        name,
        clients: browserClientFlags,
        /* `broadcast` sends a server-validated `pub` frame (the dispatcher gates it on the
           topic's `clientPublish`); `publish` is the internal channel-send function name. */
        broadcast: publish,
        tail: (count?: number, hooks?: TailHooks) => iterate(count, hooks),
        /* The latest frame this client has seen, synchronously. */
        peek: () => lastFrame,
        /* Re-pull the server's retained tail over the HTTP face (GET /__abide/sockets/<name>
           → JSON array of retained frames) and reset the local latest — a reconnect / ttl
           resync. Fire-and-forget: the fetch runs in the background and updates what peek()
           returns. A failed pull leaves the current value untouched. */
        refresh: () => {
            void fetch(withBase(`${SOCKETS_PATH}/${name}`))
                .then((response) => (response.ok ? response.json() : undefined))
                .then((frames) => {
                    if (Array.isArray(frames) && frames.length > 0) {
                        lastFrame = frames[frames.length - 1] as T
                    }
                })
                .catch(() => undefined)
        },
        [Symbol.asyncIterator]: () => iterate(0)[Symbol.asyncIterator](),
    }
}
