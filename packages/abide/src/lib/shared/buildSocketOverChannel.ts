import type { Socket } from '../server/sockets/types/Socket.ts'
import { browserClientFlags } from './browserClientFlags.ts'
import { createPushIterator } from './createPushIterator.ts'
import type { SocketChannel } from './types/SocketChannel.ts'
import type { TailHooks } from './types/TailHooks.ts'

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
    function iterate(replay: number | undefined, hooks?: TailHooks): AsyncIterable<T> {
        return {
            [Symbol.asyncIterator](): AsyncIterator<T, void, undefined> {
                const id = `s${++nextId}`
                const channel = resolveChannel()
                const iterator = createPushIterator<T>(() => channel.unsubscribe(id))
                channel.subscribe(id, name, replay, {
                    onMessage: (value) => iterator.push(value as T),
                    onReplay: (messages) => {
                        for (const value of messages) {
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
    return {
        name,
        clients: browserClientFlags,
        publish: (message: T) => resolveChannel().publish(name, message),
        tail: (count?: number, hooks?: TailHooks) => iterate(count, hooks),
        [Symbol.asyncIterator]: () => iterate(0)[Symbol.asyncIterator](),
    }
}
