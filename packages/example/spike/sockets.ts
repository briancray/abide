// `socket = channel + transport`, the same way `rpc = memo + transport`.
//
// The server half is `channel()` unchanged — there is nothing to add, because the transport is not
// in the channel, it is in the registry: an upgrade subscribes the socket to the channel and a close
// unsubscribes it. `channel.subscribe` already existed for exactly this shape.
//
// The client half is a channel whose messages arrive from a websocket. Both are `Channel<T>`, so a
// component iterating one, calling one, or reading `chunks()` cannot tell which side it is on.

import { type Channel, channel } from 'abide'
import { SOCKET_PREFIX } from './PATHS.ts'

/** The server lane. A plain channel — publishing to it reaches local readers and every subscriber
 * the registry has attached. */
export function socket<T>(): Channel<T> {
    return channel<T>({ tail: 16 })
}

/** The browser lane: the same channel, fed by the wire. */
export function remoteSocket<T>(id: string, base?: string): Channel<T> & { opened: Promise<void> } {
    const received = channel<T>({ tail: 16 }) as Channel<T> & { opened: Promise<void> }
    const path = SOCKET_PREFIX + id
    const url = (base === undefined ? path : new URL(path, base).href).replace(/^http/, 'ws')
    const connection = new WebSocket(url)
    connection.onmessage = (event: MessageEvent) => received.publish(JSON.parse(String(event.data)) as T)
    // Exposed because a caller outside a browser has to know when the subscription actually exists;
    // a publish before the upgrade completes reaches nobody, and that is a race a test would
    // otherwise hide by sleeping. `clientPublish` is the spec's answer to the other direction and is
    // not built here.
    received.opened = new Promise<void>((resolve) => {
        connection.onopen = () => resolve()
    })
    return received
}
