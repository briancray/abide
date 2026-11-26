// 18.6 — ONE FEED PER VALUE SERVED. However many connections follow a `global` GET, a change is
// watched once and its frame body serialized once, and each follower is sent it under its own id.
//
// THE REVERT is a watch per follower, each stringifying the whole value: 20 serializations of the
// value per write against 1.

import { expect, test } from 'bun:test'

import { Mux, type MuxConnection } from '#server/answerSocket.ts'
import { Followers } from '#server/Followers.ts'
import type { FollowedHandler } from '#server/mountHandlers.ts'
import { flushSync, invalidate, refresh } from '#shared'
import { applyPatch } from '#shared/applyPatch.ts'
import { keyedValue } from '#shared/reactive/index.ts'
import { rpc } from '#shared/rpc.ts'

const FOLLOWERS = 20

/** `held` with `ops` applied, as a follower standing at it would take them — 18.11, 18.41. */
function patched(held: unknown, ops: unknown): unknown {
    const copy = structuredClone(held)
    applyPatch(copy, ops as Parameters<typeof applyPatch>[1])
    return copy
}

/** `rpc`'s row as a browser follows it, with no rungs over its route. */
function followedRow(rpc: { address: string }): FollowedHandler {
    return {
        address: rpc.address,
        rungs: [],
        handler: rpc as unknown as FollowedHandler['handler'],
    }
}

/** A mux over `rpc` alone, with followers of its own. */
function muxOver(rpc: { address: string }): Mux {
    const row = followedRow(rpc)
    return new Mux(
        (address) => (address === rpc.address ? row : undefined),
        new Followers(),
        undefined,
    )
}

test('a change is serialized once for every follower of a value, and each is sent it under its own id — 18.6', async () => {
    let serialized = 0
    const shelf = (titles: string[]) => ({
        titles,
        toJSON() {
            serialized += 1
            return { titles }
        },
    })
    const value = rpc(() => shelf(['dune']), { global: true })
    const served = value as unknown as { address: string }
    served.address = '/shelf'
    const mux = muxOver(served)
    const sent: {
        op: string
        id: number
        version?: number
        base?: number
        value?: unknown
        ops?: unknown
    }[][] = []
    const connections: MuxConnection[] = []
    for (let at = 0; at < FOLLOWERS; at++) {
        const frames: {
            op: string
            id: number
            version?: number
            base?: number
            value?: unknown
            ops?: unknown
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
            JSON.stringify({ op: 'sub', id: at + 1, address: served.address }),
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
    // 18.41 — each stood at the version it was sent, so the replacement reaches it as the patch from it.
    for (let at = 0; at < FOLLOWERS; at++) {
        const [first, last] = sent[at] ?? []
        expect(last).toMatchObject({
            op: 'patch',
            id: at + 1,
            base: first?.version,
        })
        expect(patched(first?.value, last?.ops)).toEqual({
            titles: ['dune', 'emma'],
        })
    }
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
    const value = rpc(() => ({ built: built++ }), {
        global: true,
        tags: ['stock'],
    })
    const served = value as unknown as { address: string }
    served.address = '/stock'
    const mux = muxOver(served)
    const frames: { op: string; value?: unknown; ops?: unknown }[] = []
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
        JSON.stringify({ op: 'sub', id: 1, address: served.address }),
    )
    flushSync()
    invalidate({ tags: ['stock'] })
    refresh({ tags: ['stock'] })
    flushSync()
    for (let turn = 0; turn < 5; turn++) await Promise.resolve()
    flushSync()
    // 18.41 — the refresh replaced the value the follower stood at, so it is sent as the patch from it.
    expect(frames.map((frame) => frame.op)).toEqual([
        'value',
        'invalidate',
        'patch',
    ])
    expect(patched(frames[0]?.value, frames[2]?.ops)).toEqual({ built: 1 })
    connection.close()
})

// 18.40 — A FOLLOW IS A READ: each of a thousand subscriptions to a keyed `global` GET for args nothing
// has answered builds the entry for its own args and is fed from it, and from no other. THE REVERT:
// look the entry up without reaching it in `Followers.attach`; nothing is answered, so no frame is sent.
test('a subscription builds the entry for its own args and is fed from it — 18.40', async () => {
    const KEYS = 1000
    const value = keyedValue(({ id }: { id: number }) => ({ id }), {
        global: true,
    })
    const served = rpc(value as never) as unknown as { address: string }
    served.address = '/keyed'
    const mux = muxOver(served)
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
                address: served.address,
                args: { id },
            }),
        )
    flushSync()
    // 18.40 — each subscription built the entry for its own args and is fed from it alone.
    expect(`frames: ${frames.length}`).toBe(`frames: ${KEYS}`)
    let own = 0
    for (const frame of frames)
        if ((frame.value as { id: number }).id === frame.id - 1) own += 1
    expect(`fed its own: ${own}`).toBe(`fed its own: ${KEYS}`)
    connection.close()
})

// 18.6, 18.20, 18.41 — AN EVENT STREAM IS SENT THE BODY SERIALIZED FOR EVERY FOLLOWER, not one of its
// own: a write to a value twenty event streams follow serializes it once and parses nothing — here the
// patch from the value each stood at. THE REVERT:
// have `Followers.events`' peer write its event from `frame.body` parsed and stringified again — 20
// parses and 21 stringifies a write, against 0 and 1.
test('a write reaches every event stream following a value with one serialization and no parse — 18.6, 18.20', async () => {
    const STREAMS = 20
    const value = rpc(() => ({ titles: ['dune'] }), { global: true })
    const served = value as unknown as { address: string }
    served.address = '/events'
    const row = followedRow(served)
    const followers = new Followers()
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = []
    for (let at = 0; at < STREAMS; at++)
        readers.push(followers.events(row, undefined, undefined).getReader())
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
            /event: patch\nid: \d+\ndata: \[\{"op":"add","path":"\/titles\/-","value":"emma"\}\]\n\n$/,
        )
        await reader.cancel()
    }
})
