import { browserClientFlags } from '../../shared/browserClientFlags.ts'
import type { Socket } from '../../shared/types/Socket.ts'
import type { SocketRegistryEntry } from './types/SocketRegistryEntry.ts'

/* An empty async iterable — the amend channel replays nothing (live-only, no tail). */
const emptyIterable = {
    [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: true as const, value: undefined }),
    }),
}

/*
The single synthetic registry entry the dispatcher resolves every `__abide/amend/<key>`
topic to (ADR-0043). The amend value channel is a per-call reserved topic family: the
per-key Bun topic is the sub frame's own socket name, so one shared entry serves the whole
family — there is no per-key socket object or module to load. It is subscribe-only
(clientPublish false, so a browser can't forge a push), holds no tail (snapshotTail empty —
a missed frame heals via the reader's reconnect refresh), and is browser-only, so the REST
face 404s. The stub Socket methods are never reached: the ws sub path subscribes the raw
Bun topic and replays via snapshotTail, and the REST face is gated off by the clients flags.
*/
const socket = {
    name: '__abide/amend',
    clients: browserClientFlags,
    publish: () => undefined,
    tail: () => emptyIterable,
    peek: () => undefined,
    refresh: () => undefined,
    watch: () => () => undefined,
    [Symbol.asyncIterator]: emptyIterable[Symbol.asyncIterator],
} as unknown as Socket<unknown>

export const amendFamilyEntry: SocketRegistryEntry = {
    socket,
    allowClientPublish: false,
    schema: undefined,
    clients: browserClientFlags,
    snapshotTail: () => [],
}
