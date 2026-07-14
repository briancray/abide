import { AMEND_TOPIC_PREFIX } from '../../shared/AMEND_TOPIC_PREFIX.ts'
import { encodeRefJson } from '../../shared/encodeRefJson.ts'
import { keyForRemoteCall } from '../../shared/keyForRemoteCall.ts'
import { REMOTE_FUNCTION } from '../../shared/REMOTE_FUNCTION.ts'
import type { CacheSelector } from '../../shared/types/CacheSelector.ts'
import type { RawRemoteFunction } from '../../shared/types/RawRemoteFunction.ts'
import type { SocketServerFrame } from '../../shared/types/SocketServerFrame.ts'
import { getActiveServer } from './getActiveServer.ts'

/*
The server half of the isomorphic amend value form (ADR-0043): serialize the keyed
value to a standard socket `msg` frame and publish it on the per-call reserved topic
`__abide/amend/<key>`, so every browser with a live reader of that exact call (and thus
already authorized for it) sets the pushed value locally with no refetch. Installed as
the amendBroadcastSlot resolver by serverEntry ONLY — never imported from a shared or ui
module — so this server socket code stays out of the client reachability graph; the
resolver-slot indirection is the guarantee, not the ADR-0022 DCE guard (which polices the
app's own src/server edge, not abide's internal lib/server modules). Do not import this
from a client-reachable module.

Only the value form broadcasts: an updater is a closure with no wire form, so it throws
here (the mistake surfaces at the mutation site). The value must target an exact call — a
remote function with its args, or a no-input rpc's single key — since a value has to land
on one entry; a producer/closure or `{ tags }` selector has no single cross-client key and
throws. The rpc's own key derivation (keyForRemoteCall) names the topic, so it agrees with
the client cache key by construction. Subscriber-gated: skip the encode + native publish
when no client is reading that key (the topic evaporates — it holds no tail).
*/
export function broadcastAmend<Args, Return>(
    selector: CacheSelector<Args, Return>,
    args: Args | undefined,
    isValue: boolean,
    payload: Return | ((current: Return) => Return),
): void {
    if (!isValue) {
        throw new Error(
            '[abide] amend() with an updater is client-local (a closure has no wire form) — pass a value to broadcast from the server.',
        )
    }
    if (typeof selector !== 'function' || !(REMOTE_FUNCTION in selector)) {
        throw new Error(
            '[abide] amend(value) can only broadcast for a remote function — a producer/closure or { tags } selector has no cross-client key.',
        )
    }
    const remote = selector as RawRemoteFunction<Args>
    const topic = `${AMEND_TOPIC_PREFIX}${keyForRemoteCall(remote.method, remote.url, args)}`
    const server = getActiveServer()
    if (server === undefined || server.subscriberCount(`socket:${topic}`) === 0) {
        return
    }
    const frame: SocketServerFrame = { type: 'msg', socket: topic, message: payload }
    server.publish(`socket:${topic}`, encodeRefJson(frame))
}
