import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { broadcastCacheStaleness } from '../src/lib/server/runtime/cacheStalenessBroadcaster.ts'
import { serverSlot } from '../src/lib/server/runtime/serverSlot.ts'
import { defineSocket } from '../src/lib/server/sockets/defineSocket.ts'
import { socketRegistry } from '../src/lib/server/sockets/socketRegistry.ts'
import { CACHE_STALENESS_SOCKET } from '../src/lib/shared/CACHE_STALENESS_SOCKET.ts'
import { createRemoteFunction } from '../src/lib/shared/createRemoteFunction.ts'
import { decodeRefJson } from '../src/lib/shared/decodeRefJson.ts'
import type { CacheStalenessFrame } from '../src/lib/shared/types/CacheStalenessFrame.ts'
import type { SocketServerFrame } from '../src/lib/shared/types/SocketServerFrame.ts'

const BROWSER_ONLY = { browser: true, mcp: false, cli: false }

/* A minimal Server stand-in: subscriberCount is dialled per-test; publish records
   its (topic, decoded frame) so the broadcast payload can be asserted. */
function fakeServer(subscriberCount: number) {
    const published: { topic: string; frame: CacheStalenessFrame }[] = []
    const server = {
        subscriberCount: () => subscriberCount,
        publish: (topic: string, data: string) => {
            /* defineSocket fans out a `msg` SocketServerFrame as ref-json — decode it back. */
            const frame = decodeRefJson(data) as Extract<SocketServerFrame, { type: 'msg' }>
            published.push({ topic, frame: frame.message as CacheStalenessFrame })
            return 1
        },
    } as unknown as Server<unknown>
    return { server, published }
}

describe('server cache-staleness broadcast (ADR-0041)', () => {
    const previousServer = serverSlot.active
    beforeEach(() => {
        /* Mint the reserved topic exactly as createServer does at boot. */
        defineSocket(CACHE_STALENESS_SOCKET, { tail: 0, clientPublish: false })
    })
    afterEach(() => {
        serverSlot.active = previousServer
        socketRegistry.delete(CACHE_STALENESS_SOCKET)
    })

    const getUser = createRemoteFunction<{ id: number }, { name: string }>({
        method: 'GET',
        url: '/rpc/broadcast-user',
        clients: BROWSER_ONLY,
        buildRequest: () => new Request('http://x/rpc/broadcast-user'),
        invoke: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    })

    test('publishes the invalidate envelope to socket:__abide/cache when a client subscribes', () => {
        const { server, published } = fakeServer(1)
        serverSlot.active = server

        broadcastCacheStaleness('invalidate', getUser, { id: 5 })

        expect(published).toHaveLength(1)
        expect(published[0]?.topic).toBe(`socket:${CACHE_STALENESS_SOCKET}`)
        expect(published[0]?.frame).toEqual({
            op: 'invalidate',
            mode: 'key',
            match: 'GET /rpc/broadcast-user?id=5',
            tags: [],
        })
    })

    test('publishes a refresh prefix envelope for a bare fn selector', () => {
        const { server, published } = fakeServer(1)
        serverSlot.active = server

        broadcastCacheStaleness('refresh', getUser)

        expect(published[0]?.frame).toEqual({
            op: 'refresh',
            mode: 'prefix',
            match: 'GET /rpc/broadcast-user',
            tags: [],
        })
    })

    test('is subscriber-gated — no native fan-out when zero clients subscribe', () => {
        const { server, published } = fakeServer(0)
        serverSlot.active = server

        broadcastCacheStaleness('invalidate', getUser)

        expect(published).toEqual([])
    })

    test('rejects a producer selector at encode time (not cross-client serializable)', () => {
        const { server } = fakeServer(1)
        serverSlot.active = server
        const produce = async () => 1
        expect(() => broadcastCacheStaleness('invalidate', produce)).toThrow(/not cross-client/)
    })

    test('a reserved __abide/ topic can never register client-publishable (no forge vector)', () => {
        expect(() => defineSocket('__abide/forged', { clientPublish: true })).toThrow(/reserved/)
        socketRegistry.delete('__abide/forged')
    })
})
