import type { Socket } from '../server/sockets/types/Socket.ts'
import { browserClientFlags } from '../shared/browserClientFlags.ts'
import { createPushIterator } from '../shared/createPushIterator.ts'
import type { TailHooks } from '../shared/types/TailHooks.ts'
import { getSocketChannel } from './socketChannel.ts'

let nextId = 0

/*
Client-side substitute for a server-declared Socket. The bundler emits
one call per socket export under `src/server/sockets/`: server target uses
defineSocket (real fan-out), browser target uses socketProxy (subscribe
over the multiplexed ws channel). Both paths produce identical Socket
shapes so user code reads the same on either side.

Bare iteration is the live stream — no replay. `.tail(n)` opens a
subscription seeded with the last `n` retained frames (no-arg = the whole
retained tail, clamped server-side to the topic's declared `tail` size).
Each subscription mints its own id
used to route lifecycle frames (`end`, `err`). Calling `.publish` sends
a `pub` frame the server validates against the topic's
`allowClientPublish` policy — there is no client-side enforcement, so a
publish attempt on a server-only topic is silently dropped server-side.

Backpressure is unbounded — a slow consumer with a chatty socket will
grow the per-iterator buffer; bounded policies belong in a future
socketProxy API, not the wire layer.
*/
export function socketProxy<T>(name: string): Socket<T> {
    /*
    replay === undefined → the whole retained tail (`.tail()` no-arg);
    replay: number → trailing-n replay, clamped by the server — `0` is
    live-only, the bare for-await behavior. The server's per-sub `replay`
    batch is unpacked into the iterator, then `hooks.replayed` is queued
    in-band so a window reader commits its seed atomically, strictly
    after the replayed frames and before any live frame.
    */
    function iterate(replay: number | undefined, hooks?: TailHooks): AsyncIterable<T> {
        return {
            [Symbol.asyncIterator](): AsyncIterator<T, void, undefined> {
                const id = `s${++nextId}`
                const channel = getSocketChannel()
                const iter = createPushIterator<T>(() => channel.unsubscribe(id))
                channel.subscribe(id, name, replay, {
                    onMessage: (value) => iter.push(value as T),
                    onReplay: (messages) => {
                        for (const value of messages) {
                            iter.push(value as T)
                        }
                        if (hooks?.replayed) {
                            iter.control(hooks.replayed)
                        }
                    },
                    onEnd: () => iter.end(),
                    onError: (message) => iter.error(message),
                    onDisconnect: () => iter.disconnect(),
                })
                return iter
            },
        }
    }

    return {
        name,
        clients: browserClientFlags,
        publish(message: T) {
            getSocketChannel().publish(name, message)
        },
        tail: (count?: number, hooks?: TailHooks) => iterate(count, hooks),
        [Symbol.asyncIterator]: () => iterate(0)[Symbol.asyncIterator](),
    }
}
