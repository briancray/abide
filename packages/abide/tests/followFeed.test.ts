// 18.6 — ONE FEED PER VALUE SERVED. However many connections follow a `global` GET, a change is
// watched once and its frame body serialized once, and each follower is sent it under its own id.
//
// THE REVERT is a watch per follower, each stringifying the whole value: 20 serializations of the
// value per write against 1.

import { expect, test } from 'bun:test'

import {
    feedFromServed,
    followAsEvents,
    Mux,
    type MuxConnection,
} from '#server/answerSocket.ts'
import { flushSync, invalidate, reactive, refresh } from '#shared'
import { GLOBAL_GETS } from '#shared/GLOBAL_GETS.ts'
import { GET } from '#shared/rpc.ts'

const FOLLOWERS = 20

test('a change is serialized once for every follower of a value, and each is sent it under its own id — 18.6', async () => {
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
    rpc.address = '/shelf'
    const mux = new Mux(
        new Map([
            [
                `GET ${rpc.address}`,
                { handler: rpc, ui: true, scope: '/', rungs: [] } as never,
            ],
        ]),
        undefined,
    )
    const sent: {
        op: string
        id: number
        version?: number
        value?: unknown
    }[][] = []
    const connections: MuxConnection[] = []
    for (let at = 0; at < FOLLOWERS; at++) {
        const frames: {
            op: string
            id: number
            version?: number
            value?: unknown
        }[] = []
        sent.push(frames)
        const connection = mux.connect(
            new Request('http://app.test/__abide/socket'),
            {
                send(text: string) {
                    frames.push(JSON.parse(text))
                },
                close() {},
            },
        )
        connections.push(connection)
        await connection.message(
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
    for (const connection of connections) connection.close()
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
    rpc.address = '/stock'
    const mux = new Mux(
        new Map([
            [
                `GET ${rpc.address}`,
                { handler: rpc, ui: true, scope: '/', rungs: [] } as never,
            ],
        ]),
        undefined,
    )
    const frames: { op: string; value?: unknown }[] = []
    const connection = mux.connect(
        new Request('http://app.test/__abide/socket'),
        {
            send(text: string) {
                frames.push(JSON.parse(text))
            },
            close() {},
        },
    )
    await connection.message(
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
    connection.close()
})

// 18.8 — AN ENTRY ANSWERED REACHES THE FOLLOWERS OF ITS OWN ARGS, and walks no other: an answer of a
// keyed `global` GET nobody was fed from looks up the entry of each follower filed under its key,
// and of none of the thousand following other keys. THE REVERT: walk every follower of the handler
// in `feedFromServed`, as before the followers were filed by key — 1000 entry lookups an answer,
// against 1, and a request that pays ~60 µs at 1000 followers and ~600 µs at 10000.
test('an entry answered looks up the followers of its own key alone — 18.8', async () => {
    const KEYS = 1000
    const value = reactive(({ id }: { id: number }) => ({ id }), {
        global: true,
    })
    const rpc = GET(value as never) as unknown as { address: string }
    rpc.address = '/keyed'
    const mux = new Mux(
        new Map([
            [
                `GET ${rpc.address}`,
                { handler: rpc, ui: true, scope: '/', rungs: [] } as never,
            ],
        ]),
        undefined,
    )
    const frames: {
        op: string
        id: number
        version?: number
        value?: unknown
    }[] = []
    const connection = mux.connect(
        new Request('http://app.test/__abide/socket'),
        {
            send(text: string) {
                frames.push(JSON.parse(text))
            },
            close() {},
        },
    )
    for (let id = 0; id < KEYS; id++)
        await connection.message(
            JSON.stringify({
                op: 'sub',
                id: id + 1,
                address: rpc.address,
                args: { id },
            }),
        )
    flushSync()
    // Nothing was answered yet, so nothing is fed.
    expect(frames).toEqual([])
    ;(value as unknown as (args: { id: number }) => unknown)({ id: 0 })
    const global = GLOBAL_GETS.get(rpc) as NonNullable<
        ReturnType<typeof GLOBAL_GETS.get>
    >
    const key = global.key({ id: 0 })
    const serving = global.at(key)
    const at = global.at
    let looked = 0
    global.at = (asked) => {
        looked += 1
        return at(asked)
    }
    try {
        feedFromServed(rpc, serving, key)
    } finally {
        global.at = at
    }
    flushSync()
    expect(`looked: ${looked}`).toBe('looked: 1')
    expect(frames).toEqual([
        { op: 'value', id: 1, version: expect.any(Number), value: { id: 0 } },
    ])
    connection.close()
})

// 18.6, 18.20 — AN EVENT STREAM IS SENT THE BODY SERIALIZED FOR EVERY FOLLOWER, not one of its own:
// a write to a value twenty event streams follow serializes it once and parses nothing. THE REVERT:
// have `followAsEvents`'s peer write its event from `frame.body` parsed and stringified again — 20
// parses and 21 stringifies a write, against 0 and 1.
test('a write reaches every event stream following a value with one serialization and no parse — 18.6, 18.20', async () => {
    const STREAMS = 20
    const value = reactive({ titles: ['dune'] }, { global: true })
    const rpc = GET(value as never) as unknown as { address: string }
    rpc.address = '/events'
    const mounted = { handler: rpc, ui: true, scope: '/', rungs: [] } as never
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = []
    for (let at = 0; at < STREAMS; at++)
        readers.push(followAsEvents(mounted, undefined, undefined).getReader())
    const { parse, stringify } = JSON
    let parsed = 0
    let stringified = 0
    JSON.parse = ((...given: Parameters<typeof parse>) => {
        parsed += 1
        return parse(...given)
    }) as typeof parse
    JSON.stringify = ((...given: Parameters<typeof stringify>) => {
        stringified += 1
        return stringify(...given)
    }) as typeof stringify
    try {
        value.set({ titles: ['dune', 'emma'] })
        flushSync()
    } finally {
        JSON.parse = parse
        JSON.stringify = stringify
    }
    expect(`parsed: ${parsed}, stringified: ${stringified}`).toBe(
        'parsed: 0, stringified: 1',
    )
    const decoder = new TextDecoder()
    for (const reader of readers) {
        let text = ''
        while (!text.includes('emma')) {
            const { value: chunk } = await reader.read()
            text += decoder.decode(chunk)
        }
        expect(text).toMatch(
            /event: value\nid: \d+\ndata: \{"titles":\["dune","emma"\]\}\n\n$/,
        )
        await reader.cancel()
    }
})
