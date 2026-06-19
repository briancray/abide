import type { Patch } from '../runtime/types/Patch.ts'

/*
The bidirectional channel `sync` rides: `send` publishes a local patch to peers,
`subscribe` delivers patches from peers (returning an unsubscribe). Deliberately
minimal and patch-shaped — an app adapts it to a `socket` (publish ⇒ `send`, the
socket's frames ⇒ `subscribe`), and a test adapts it to an in-memory hub. A patch
is already the serializable wire unit, so nothing else is needed.
*/
export type SyncTransport = {
    send: (patch: Patch) => void
    subscribe: (onPatch: (patch: Patch) => void) => () => void
}
