// channel(...) — the args-keyed pub/sub primitive (ADR 0023). Covers the void (single-topic) default and
// per-room isolation over the same primitive.

import { expect, test } from 'bun:test'
import { channel } from './channel.ts'

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function collect<T>(source: AsyncIterable<T>, count: number): Promise<T[]> {
    const received: T[] = []
    for await (const message of source) {
        received.push(message)
        if (received.length >= count) break
    }
    return received
}

test('void channel: direct iteration subscribes, publish fans out, peek/chunks read the topic', async () => {
    const ch = channel<number>({ tail: 3 })
    const got = collect(ch, 2) // `for await m of channel` = the default (void) room
    await delay(5)
    ch.publish(undefined, 1)
    ch.publish(undefined, 2)
    expect(await got).toEqual([1, 2])
    expect(ch.peek(undefined)).toBe(2)
    expect(ch.chunks(undefined)).toEqual([1, 2])
})

test('rooms: a subscriber to room A does NOT receive room B (server-side isolation)', async () => {
    const ch = channel<string, { room: string }>({ tail: 2 })
    const a = collect(ch({ room: 'a' }), 1)
    const b = collect(ch({ room: 'b' }), 1)
    await delay(5)
    ch.publish({ room: 'a' }, 'to-a')
    expect(await a).toEqual(['to-a']) // a resolves; b is still pending (never saw 'to-a')
    ch.publish({ room: 'b' }, 'to-b')
    expect(await b).toEqual(['to-b'])
    expect(ch.peek({ room: 'a' })).toBe('to-a')
    expect(ch.peek({ room: 'b' })).toBe('to-b')
})

test('a late joiner to a room replays only that room’s tail', async () => {
    const ch = channel<number, { room: string }>({ tail: 3 })
    ch.publish({ room: 'x' }, 1)
    ch.publish({ room: 'x' }, 2)
    ch.publish({ room: 'y' }, 99)
    expect(await collect(ch({ room: 'x' }), 2)).toEqual([1, 2]) // not 99
})

test('invalidate clears a room’s retained tail without detaching live subscribers', async () => {
    const ch = channel<number, { room: string }>({ tail: 5 })
    const live = collect(ch({ room: 'x' }), 2)
    await delay(5)
    ch.publish({ room: 'x' }, 1)
    expect(ch.chunks({ room: 'x' })).toEqual([1])
    ch.invalidate({ room: 'x' })
    expect(ch.chunks({ room: 'x' })).toEqual([]) // retained tail cleared
    ch.publish({ room: 'x' }, 2) // the live subscriber is still attached and receives it
    expect(await live).toEqual([1, 2])
})

test('watch fires the handler per message on a room', async () => {
    const ch = channel<string, { room: string }>()
    const seen: string[] = []
    const dispose = ch.watch({ room: 'r' }, (v) => {
        if (v !== undefined) seen.push(v)
    })
    await delay(5)
    ch.publish({ room: 'r' }, 'a')
    ch.publish({ room: 'r' }, 'b')
    await delay(5)
    dispose()
    ch.publish({ room: 'r' }, 'c') // after dispose — must NOT be seen
    await delay(5)
    expect(seen).toEqual(['a', 'b'])
})
