import type { SocketFunction } from '../types/SocketFunction.ts'
import { getSocketRpcChannel } from './socketRpcChannel.ts'

let nextId = 0

/*
Client-side substitute for a SOCKET-defined handler. The bundler emits
one call per SOCKET export inside an `$rpc/**` module: server target
uses defineSocket (real handler), browser target uses socketProxy
(subscribe over the multiplexed ws channel). Both paths produce
identical SocketFunction shapes so cache() and SSR snapshots can treat
them uniformly with HTTP-verb rpcs above the wire.

Each call mints a fresh subscription id, opens it on the shared channel,
and returns an async generator that drains incoming frames. Consumer-
side `break` / `return` runs the generator's `finally` which sends a
`close` frame back — the server's dispatcher in turn calls `return()`
on the handler iterator. Server-initiated end (`done`) just exits the
loop; server-initiated error (`error`) throws into the consumer.
*/
export function socketProxy<Args, Frame>(url: string): SocketFunction<Args, Frame> {
    function call(args: Args): AsyncIterable<Frame> {
        return iterate(url, args) as AsyncIterable<Frame>
    }
    call.url = url
    call.stream = (args: Args): AsyncIterable<Frame> => iterate(url, args) as AsyncIterable<Frame>
    call.dispatch = (args: Args): AsyncIterable<Frame> => iterate(url, args) as AsyncIterable<Frame>
    return call as SocketFunction<Args, Frame>
}

type Slot =
    | { kind: 'value'; value: unknown }
    | { kind: 'done' }
    | { kind: 'error'; message: string }

async function* iterate(url: string, args: unknown): AsyncGenerator<unknown> {
    const id = String(++nextId)
    const channel = getSocketRpcChannel()
    /*
    Single-slot mailbox + matched waiter: each yielded frame either
    lands in the buffer (if no one's awaiting) or wakes the pending
    pull. Backpressure is unbounded — a slow consumer with a chatty
    handler will grow the buffer; bounded policies (drop-oldest, drop-
    newest, conflate-to-latest) belong in a future API on socketProxy,
    not in the wire layer.
    */
    const buffer: Slot[] = []
    let waiter: ((slot: Slot) => void) | undefined

    function push(slot: Slot): void {
        if (waiter) {
            const w = waiter
            waiter = undefined
            w(slot)
            return
        }
        buffer.push(slot)
    }

    channel.subscribe(id, url, args, {
        onFrame: (value) => push({ kind: 'value', value }),
        onDone: () => push({ kind: 'done' }),
        onError: (message) => push({ kind: 'error', message }),
    })

    try {
        while (true) {
            const slot = buffer.shift() ?? (await new Promise<Slot>((r) => (waiter = r)))
            if (slot.kind === 'done') {
                return
            }
            if (slot.kind === 'error') {
                throw new Error(slot.message)
            }
            yield slot.value
        }
    } finally {
        channel.unsubscribe(id)
    }
}
