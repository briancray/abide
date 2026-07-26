// The connection-local key for one socket subscription, shared by all three ends that hold a
// subscription map: the server's per-connection `SocketConnection.subscriptions`, the browser mux's
// `subscriptions`, and the test app's WS router. Each map is keyed locally (the key never crosses the
// wire), but they must AGREE on when a room is folded in — otherwise one end coalesces two rooms of one
// socket into a single subscription while the other keeps them apart.
//
// A void socket keys by bare `name`. So does an `@rpc:` cache channel: its args are already baked into
// its NAME, and its downstream frames carry no `args` — so folding them in would key the subscribe and
// the echo differently. A roomed USER socket folds in `canonicalKey(args)` so distinct rooms of the same
// socket are distinct subscriptions on one connection.
//
// The separator is a NUL, written as an escape: it is the one character a socket name or a canonical key
// cannot contain, so `a\0b` and `a` + `\0b` can never collide. Writing it as a literal byte (as the
// server's copy of this function once did) makes the source file BINARY to grep/knip and friends, which
// then silently skip it.

import { canonicalKey } from './codec.ts'
import { RPC_CHANNEL_PREFIX } from './memoChannelName.ts'

const SEPARATOR = '\0'

export function subscriptionKey(name: string, args: unknown): string {
    if (args === undefined || name.startsWith(RPC_CHANNEL_PREFIX)) return name
    return `${name}${SEPARATOR}${canonicalKey(args)}`
}
