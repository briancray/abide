import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { broadcastAmend } from '../src/lib/server/runtime/amendBroadcaster.ts'
import { serverSlot } from '../src/lib/server/runtime/serverSlot.ts'
import { createRemoteFunction } from '../src/lib/shared/createRemoteFunction.ts'
import { decodeRefJson } from '../src/lib/shared/decodeRefJson.ts'
import type { SocketServerFrame } from '../src/lib/shared/types/SocketServerFrame.ts'

const BROWSER_ONLY = { browser: true, mcp: false, cli: false }

/* A minimal Server stand-in: subscriberCount is dialled per-test; publish records its
   (topic, decoded value) so the broadcast payload can be asserted. */
function fakeServer(subscriberCount: number) {
    const published: { topic: string; message: unknown }[] = []
    const server = {
        subscriberCount: () => subscriberCount,
        publish: (topic: string, data: string) => {
            const frame = decodeRefJson(data) as Extract<SocketServerFrame, { type: 'msg' }>
            published.push({ topic, message: frame.message })
            return 1
        },
    } as unknown as Server<unknown>
    return { server, published }
}

const getUser = createRemoteFunction<{ id: number }, { name: string }>({
    method: 'GET',
    url: '/rpc/amend-user',
    clients: BROWSER_ONLY,
    buildRequest: () => new Request('http://x/rpc/amend-user'),
    invoke: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
})

describe('server amend value broadcast (ADR-0043)', () => {
    const previousServer = serverSlot.active
    afterEach(() => {
        serverSlot.active = previousServer
    })

    test('publishes the keyed value to socket:__abide/amend/<key> when a client reads that key', () => {
        const { server, published } = fakeServer(1)
        serverSlot.active = server

        broadcastAmend(getUser, { id: 5 }, true, { name: 'Ada' })

        expect(published).toHaveLength(1)
        expect(published[0]?.topic).toBe('socket:__abide/amend/GET /rpc/amend-user?id=5')
        expect(published[0]?.message).toEqual({ name: 'Ada' })
    })

    test('is subscriber-gated — no fan-out when zero clients read that key', () => {
        const { server, published } = fakeServer(0)
        serverSlot.active = server

        broadcastAmend(getUser, { id: 5 }, true, { name: 'Ada' })

        expect(published).toEqual([])
    })

    test('throws on an updater — a closure has no wire form', () => {
        const { server } = fakeServer(1)
        serverSlot.active = server

        expect(() => broadcastAmend(getUser, { id: 5 }, false, (user) => user)).toThrow(
            /client-local/,
        )
    })

    test('throws on a producer selector — no cross-client key', () => {
        const { server } = fakeServer(1)
        serverSlot.active = server
        const produce = async () => ({ name: 'x' })

        expect(() => broadcastAmend(produce, undefined, true, { name: 'x' })).toThrow(
            /remote function/,
        )
    })
})
