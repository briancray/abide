// channel(...) — the args-keyed pub/sub primitive (ADR 0023). Covers the void (single-topic) default,
// per-room isolation over the same primitive, and the isomorphism claim: `channel` lives in `shared`
// and runs unchanged wherever `state` and `memo` do.

import { expect, test } from 'bun:test'
import { channel } from './channel.ts'
import { memo } from './memo.ts'

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
    // A void channel has no room to name: the message is the ONLY argument (`Room<void>` = `[]`).
    ch.publish(1)
    ch.publish(2)
    expect(await got).toEqual([1, 2])
    expect(ch.live()).toBe(2)
    expect(ch.chunks()).toEqual([1, 2])
})

test('void channel: the explicit (undefined, message) form unpacks to the same room', async () => {
    const ch = channel<number>({ tail: 2 })
    ch.publish(undefined, 1) // the generic-safe two-argument form (what forwarding code emits)
    ch.publish(2)
    expect(ch.chunks()).toEqual([1, 2])
    expect(ch.live()).toBe(2)
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
    expect(ch.live({ room: 'a' })).toBe('to-a')
    expect(ch.live({ room: 'b' })).toBe('to-b')
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

// `watch` is the other verb with a TRAILING payload, so it takes the same vanishing key positional
// `publish` does — the handler is the only argument on a void channel.
test('watch on a void channel takes the handler alone (no room placeholder)', async () => {
    const ch = channel<string>()
    const seen: string[] = []
    const dispose = ch.watch((v) => {
        if (v !== undefined) seen.push(v)
    })
    await delay(5)
    ch.publish('a')
    await delay(5)
    dispose()
    ch.publish('b')
    await delay(5)
    expect(seen).toEqual(['a'])
})

// The unification guard (ADR 0023): `state` / `memo` / `channel` are the three isomorphic primitives, so
// `channel` must carry the SAME reactive read surface `memo` does — the vocabulary a caller programs to
// is the primitive's, not the transport's. If a probe is ever added to one and not the other, the
// "same vocabulary" claim in CLAUDE.md quietly stops being true; this test fails instead.
test('channel exposes the same reactive read surface as memo', () => {
    const ch = channel<number>()
    const mo = memo(async () => 1)
    const SURFACE = [
        'live',
        'chunks',
        'pending',
        'refreshing',
        'settled',
        'error',
        'done',
        'streaming',
        'refresh',
        'invalidate',
        'watch',
        'publish',
    ] as const
    for (const probe of SURFACE) {
        expect(typeof (ch as unknown as Record<string, unknown>)[probe]).toBe('function')
        expect(typeof (mo as unknown as Record<string, unknown>)[probe]).toBe('function')
    }
})

// `channel` is in `shared`, so it must not reach for anything server-only. The suite runs under
// happy-dom (a `document` IS present), which is the browser shape — a channel created and driven here
// proves the primitive needs no request scope, no hub registry, no transport.
test('channel runs in a browser-shaped environment (isomorphic, no server scope)', async () => {
    expect(typeof document).not.toBe('undefined')
    const ch = channel<string>({ tail: 1 })
    const seen = collect(ch, 1)
    await delay(5)
    ch.publish('browser')
    expect(await seen).toEqual(['browser'])
    expect(ch.live()).toBe('browser')
})
