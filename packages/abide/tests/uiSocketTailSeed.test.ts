import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { defineSocket } from '../src/lib/server/sockets/defineSocket.ts'
import { encodeRefJson } from '../src/lib/shared/encodeRefJson.ts'
import { peek } from '../src/lib/shared/peek.ts'
import { SOCKET_SEED } from '../src/lib/shared/SOCKET_SEED.ts'
import { socketTailsSlot } from '../src/lib/shared/socketTailsSlot.ts'
import type { SocketTails } from '../src/lib/shared/types/SocketTails.ts'
import { socketProxy } from '../src/lib/ui/socketProxy.ts'
import { installMiniDom } from './support/installMiniDom.ts'

/*
Socket tail warm-seed. A `tail: 1` socket retains its last frame, so the SERVER's `peek(socket)`
returns it during SSR while a not-yet-connected client's `peek(socket)` returns undefined — the two
disagree and hydration discards the server markup. Sockets carry a server value forward like async
cells (not withhold on the client like cache, whose server peek is uniformly undefined): the server
records each peeked frame keyed by socket name (`defineSocket.peek` → `socketTailsSlot`), the renderer
stamps it into `__SSR__.sockets`, and on the client `socketProxy` seeds `lastFrame` so `peek` returns
the same retained value the server rendered.
*/
beforeAll(() => {
    installMiniDom()
})

describe('server records the retained frame peeked during an SSR render', () => {
    let previous: typeof socketTailsSlot.resolver
    let tails: SocketTails
    beforeEach(() => {
        previous = socketTailsSlot.resolver
        tails = { entries: [] }
        socketTailsSlot.resolver = () => tails
    })
    afterEach(() => {
        socketTailsSlot.resolver = previous
    })

    test('peek(socket) records {name, value} for a retained (tail:1) socket', () => {
        const refreshStatus = defineSocket<boolean>('socketSeed:refreshStatus')
        refreshStatus.publish(true)
        expect(peek(refreshStatus)).toBe(true)
        expect(tails.entries).toEqual([{ name: 'socketSeed:refreshStatus', value: true }])
    })

    test('the latest read wins — the renderer keys by name, so a re-peek ships the current frame', () => {
        const status = defineSocket<string>('socketSeed:relay')
        status.publish('scanning')
        peek(status)
        status.publish('idle')
        peek(status)
        // The renderer collapses by name (last write wins); both reads are recorded in order.
        expect(tails.entries.map((entry) => entry.value)).toEqual(['scanning', 'idle'])
    })

    test('a tail:0 socket retains nothing → peek records nothing', () => {
        const live = defineSocket<number>('socketSeed:live', { tail: 0 })
        live.publish(1)
        expect(peek(live)).toBeUndefined()
        expect(tails.entries).toHaveLength(0)
    })

    test('off-request (no resolver) — peek records nothing and does not throw', () => {
        socketTailsSlot.resolver = undefined
        const offReq = defineSocket<boolean>('socketSeed:offReq')
        offReq.publish(true)
        expect(peek(offReq)).toBe(true)
    })
})

describe('the client seeds peek from __SSR__.sockets before ws connect', () => {
    afterEach(() => {
        for (const key of Object.keys(SOCKET_SEED)) {
            delete SOCKET_SEED[key]
        }
    })

    test('socketProxy adopts the seeded frame so peek returns the server value at hydration', () => {
        // Seed as the renderer would: ref-json-encode the SSR-retained frame under the socket name.
        SOCKET_SEED['socketSeed:clientA'] = encodeRefJson(true)
        const proxy = socketProxy<boolean>('socketSeed:clientA')
        // No ws is opened (the channel resolves lazily on subscribe); peek is the seeded snapshot.
        expect(peek(proxy)).toBe(true)
    })

    test('a structured frame round-trips through the ref-json codec', () => {
        SOCKET_SEED['socketSeed:clientObj'] = encodeRefJson({ scanning: true, at: 7 })
        const proxy = socketProxy<{ scanning: boolean; at: number }>('socketSeed:clientObj')
        expect(peek(proxy)).toEqual({ scanning: true, at: 7 })
    })

    test('a missing seed → peek undefined (cold, unchanged behavior)', () => {
        const proxy = socketProxy<boolean>('socketSeed:clientMissing')
        expect(peek(proxy)).toBeUndefined()
    })
})
