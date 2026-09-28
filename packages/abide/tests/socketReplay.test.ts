// 18.13 AGAINST 6.5 AND 6.17: what a fresh socket subscription replays is what `s.history()` answers
// for the same value — the mux reaches the retained productions through the same window the member
// does, so an expired production is not replayed.
//
// THE REVERT for all three is `answerSocket.ts` reading the cell by hand again — its own adoption
// walk, floor arithmetic and turn count: ['a', 'b', 'c'] against ['c'], '1:c' against '3:c' after the
// sweep, and '1:c' against '3:c' on the collapsed live tail.

import { expect, setSystemTime, test } from 'bun:test'
import { reactive } from '#shared'
import { socket } from '#shared/socket.ts'
import {
    connectionOf,
    type MuxSocket,
    socketHandlers,
} from '#server/answerSocket.ts'

async function frames(
    value: unknown,
): Promise<{ op: string; seq?: number; value?: unknown }[]> {
    const sent: { op: string; seq?: number; value?: unknown }[] = []
    const ws = {
        data: connectionOf(new Request('http://app.test/__abide/socket')),
        send(text: string) {
            sent.push(JSON.parse(text))
        },
    } satisfies MuxSocket
    const handlers = socketHandlers(
        new Map([['/room', socket(value as never)]]) as never,
        new Map(),
    )
    await handlers.message(
        ws,
        JSON.stringify({ op: 'sub', id: 1, address: '/room' }),
    )
    handlers.close(ws)
    return sent
}

async function replayed(value: unknown): Promise<unknown[]> {
    const values: unknown[] = []
    for (const frame of await frames(value))
        if (frame.op === 'prod') values.push(frame.value)
    return values
}

test('an expired production is not replayed to a fresh socket subscriber — 6.5, 18.13', async () => {
    const room = reactive<string>(undefined, {
        history: 9,
        ttl: 60_000,
        global: true,
    })
    room.publish('a')
    room.publish('b')
    const realNow = Date.now()
    setSystemTime(new Date(realNow + 60_001))
    try {
        room.publish('c')
        expect(await replayed(room)).toEqual([...room.history()])
        expect(await replayed(room)).toEqual(['c'])
    } finally {
        setSystemTime()
    }
})

// 18.10: A REPLAYED PRODUCTION CARRIES THE SEQUENCE ITS OWNER MINTED, and a ring an expiry has
// shortened starts past the value's depth. Numbering the replay from the depth rather than from
// what is retained hands `c` — the third production — the number 1.
test('a replay after an expiry numbers each production with its own ordinal — 18.10, 6.5', async () => {
    const room = reactive<string>(undefined, {
        history: 9,
        ttl: 60_000,
        global: true,
    })
    room.publish('a')
    room.publish('b')
    const realNow = Date.now()
    setSystemTime(new Date(realNow + 60_001))
    try {
        room.publish('c')
        expect([...room.history()]).toEqual(['c'])
        const numbered: string[] = []
        for (const frame of await frames(room))
            if (frame.op === 'prod')
                numbered.push(`${frame.seq}:${frame.value}`)
        expect(numbered).toEqual(['3:c'])
    } finally {
        setSystemTime()
    }
})

// 18.10 ON THE LIVE TAIL: with no ring a cursor collapses what was minted between two of its turns
// onto the standing production (5.11), and the frame carries THAT production's number. Counting the
// frames instead numbers the third production 2, and a reconnect resuming from 2 is handed it again.
test('a live production carries its own ordinal where the cursor collapsed a burst — 18.10', async () => {
    const room = reactive<string>(undefined, { global: true })
    const sent: { op: string; seq?: number; value?: unknown }[] = []
    const ws = {
        data: connectionOf(new Request('http://app.test/__abide/socket')),
        send(text: string) {
            sent.push(JSON.parse(text))
        },
    } satisfies MuxSocket
    const handlers = socketHandlers(
        new Map([['/room', socket(room as never)]]) as never,
        new Map(),
    )
    await handlers.message(
        ws,
        JSON.stringify({ op: 'sub', id: 1, address: '/room' }),
    )
    room.publish('a')
    room.publish('b')
    room.publish('c')
    for (let turn = 0; turn < 10; turn++) await Promise.resolve()
    handlers.close(ws)
    const numbered: string[] = []
    for (const frame of sent)
        if (frame.op === 'prod') numbered.push(`${frame.seq}:${frame.value}`)
    expect(numbered.at(-1)).toBe('3:c')
})

// 18.3 — A SUBSCRIPTION WHOSE RUNG IS STILL PENDING WHEN THE CONNECTION CLOSES, or when its `unsub`
// lands, is never installed: the rung resolving afterwards finds its placeholder gone. THE REVERT:
// install the subscription after the rung without checking; each connection is left holding one live
// subscription, and the sizes read [1, 1].
test('a subscription whose rung resolves after the close or the unsub is not installed — 18.3', async () => {
    const room = reactive<string>(undefined, { global: true })
    const released: (() => void)[] = []
    const gated = socket(room as never, {
        middleware: [
            async (next) => {
                await new Promise<void>((done) => released.push(done))
                return next()
            },
        ],
    })
    const handlers = socketHandlers(
        new Map([['/room', gated]]) as never,
        new Map(),
    )
    const connected = () => {
        const sent: { op: string }[] = []
        const ws = {
            data: connectionOf(new Request('http://app.test/__abide/socket')),
            send(text: string) {
                sent.push(JSON.parse(text))
            },
        } satisfies MuxSocket
        return { ws, sent }
    }
    const closed = connected()
    const closing = handlers.message(
        closed.ws,
        JSON.stringify({ op: 'sub', id: 1, address: '/room' }),
    )
    handlers.close(closed.ws)
    const unsubbed = connected()
    const unsubbing = handlers.message(
        unsubbed.ws,
        JSON.stringify({ op: 'sub', id: 1, address: '/room' }),
    )
    await handlers.message(
        unsubbed.ws,
        JSON.stringify({ op: 'unsub', id: 1, address: '/room' }),
    )
    for (const release of released) release()
    await closing
    await unsubbing
    room.publish('after')
    for (let turn = 0; turn < 10; turn++) await Promise.resolve()
    expect([
        closed.ws.data.subscriptions.size,
        unsubbed.ws.data.subscriptions.size,
    ]).toEqual([0, 0])
    expect([...closed.sent, ...unsubbed.sent]).toEqual([])
    handlers.close(unsubbed.ws)
})
