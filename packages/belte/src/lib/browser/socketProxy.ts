import type { Socket } from '../server/sockets/types/Socket.ts'
import { createPushIterator } from '../shared/createPushIterator.ts'
import { getSocketChannel } from './socketChannel.ts'

let nextId = 0

/*
Browser stub is only emitted when `clients.browser: true`, so the value
is always true here. mcp/cli flags are server-only discovery state; the
browser bundle has no use for them. Default false so the public Socket
shape stays consistent on both sides.
*/
const BROWSER_CLIENT_FLAGS = { browser: true, mcp: false, cli: false } as const

/*
Client-side substitute for a server-declared Socket. The bundler emits
one call per socket export under `src/server/sockets/`: server target uses
defineSocket (real fan-out), browser target uses socketProxy (subscribe
over the multiplexed ws channel). Both paths produce identical Socket
shapes so user code reads the same on either side.

Bare iteration opens a subscription with full history replay; `.tail(n)`
opens one that replays the last `n` items (default `0`, clamped server-
side to the topic's history max). Each subscription mints its own id
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
    replay === undefined → full history replay (bare for-await);
    replay: number → trailing-n replay, clamped by the server.
    */
    function iterate(replay: number | undefined): AsyncIterable<T> {
        return {
            [Symbol.asyncIterator](): AsyncIterator<T, void, undefined> {
                const id = `s${++nextId}`
                const channel = getSocketChannel()
                const iter = createPushIterator<T>(() => channel.unsubscribe(id))
                channel.subscribe(id, name, replay, {
                    onMessage: (value) => iter.push(value as T),
                    onEnd: () => iter.end(),
                    onError: (message) => iter.error(message),
                })
                return iter
            },
        }
    }

    return {
        name,
        clients: BROWSER_CLIENT_FLAGS,
        publish(message: T) {
            getSocketChannel().publish(name, message)
        },
        tail: (count = 0) => iterate(count),
        [Symbol.asyncIterator]: () => iterate(undefined)[Symbol.asyncIterator](),
    }
}
