// 18.21 — ONE FEED PER VALUE SERVED. However many connections follow a `global` GET, a change is
// watched once and its frame body serialized once, and each follower is sent it under its own id.
//
// THE REVERT is a watch per follower, each stringifying the whole value: 20 serializations of the
// value per write against 1.

import { expect, test } from 'bun:test'
import { flushSync, invalidate, reactive, refresh } from '#shared'
import { GET } from '#shared/rpc.ts'
import {
    connectionOf,
    type MuxSocket,
    socketHandlers,
} from '#server/answerSocket.ts'

const FOLLOWERS = 20

test('a change is serialized once for every follower of a value, and each is sent it under its own id — 18.21', async () => {
    let serialized = 0
    const shelf = (titles: string[]) => ({
        titles,
        toJSON() {
            serialized += 1
            return { titles }
        },
    })
    const value = reactive(shelf(['dune']), { global: true })
    const rpc = GET(value as never) as unknown as { address: string }
    rpc.address = '/__abide/rpc/shelf'
    const handlers = socketHandlers(
        new Map(),
        new Map([[rpc.address, { handler: rpc, ui: true } as never]]),
    )
    const sent: {
        op: string
        id: number
        version?: number
        value?: unknown
    }[][] = []
    const sockets: MuxSocket[] = []
    for (let at = 0; at < FOLLOWERS; at++) {
        const frames: {
            op: string
            id: number
            version?: number
            value?: unknown
        }[] = []
        sent.push(frames)
        const ws = {
            data: connectionOf(new Request('http://app.test/__abide/socket')),
            send(text: string) {
                frames.push(JSON.parse(text))
            },
        } satisfies MuxSocket
        sockets.push(ws)
        await handlers.message(
            ws,
            JSON.stringify({ op: 'sub', id: at + 1, address: rpc.address }),
        )
    }
    // A follower joining after the first is sent what stands, as the first was.
    for (let at = 0; at < FOLLOWERS; at++)
        expect(sent[at]).toEqual([
            {
                op: 'value',
                id: at + 1,
                version: expect.any(Number),
                value: { titles: ['dune'] },
            },
        ])
    serialized = 0
    value.set(shelf(['dune', 'emma']))
    flushSync()
    expect(serialized).toBe(1)
    for (let at = 0; at < FOLLOWERS; at++)
        expect(sent[at]?.at(-1)).toMatchObject({
            op: 'value',
            id: at + 1,
            value: { titles: ['dune', 'emma'] },
        })
    for (const ws of sockets) handlers.close(ws)
    value.set(shelf(['gone']))
    flushSync()
    expect(sent[0]?.length).toBe(2)
})

// 7.10, 7.18, 13.4 — A TRIGGER OVER A TAG reaches the copies a value it names is feeding, as the
// \`Rpc\`'s own does. THE REVERT: broadcast from the \`Rpc\`'s members alone; the tag's invalidate
// sends no frame.
test('a free invalidate and refresh over a tag reach the followers of the GET serving it — 7.10, 7.18', async () => {
    let built = 0
    const value = reactive(() => ({ built: built++ }), {
        global: true,
        tags: ['stock'],
    })
    const rpc = GET(value as never) as unknown as { address: string }
    rpc.address = '/__abide/rpc/stock'
    const handlers = socketHandlers(
        new Map(),
        new Map([[rpc.address, { handler: rpc, ui: true } as never]]),
    )
    const frames: { op: string; value?: unknown }[] = []
    const ws = {
        data: connectionOf(new Request('http://app.test/__abide/socket')),
        send(text: string) {
            frames.push(JSON.parse(text))
        },
    } satisfies MuxSocket
    await handlers.message(
        ws,
        JSON.stringify({ op: 'sub', id: 1, address: rpc.address }),
    )
    flushSync()
    invalidate({ tags: ['stock'] })
    refresh({ tags: ['stock'] })
    flushSync()
    for (let turn = 0; turn < 5; turn++) await Promise.resolve()
    flushSync()
    expect(frames.map((frame) => frame.op)).toEqual([
        'value',
        'invalidate',
        'value',
    ])
    handlers.close(ws)
})
