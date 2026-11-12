// 9.17 — A RUN'S END NEVER OVERTAKES ITS LAST CHUNK. A generator returning in the turn of its last
// yield lands that chunk and its close together, and a reader that joined the run mid-way — through a
// value forwarding it (11.15), which is what a handler handing back a `global` value is — read the
// close first and ended a chunk short. Every lane a streamed `GET` is read over is driven here, and
// the WHOLE received sequence is compared, never its ends.
//
// THE REVERT: drop both `tellOwed` calls from `pump` in `Reactive.ts` — 72 of 108 cases end short, 12
// on each lane, the whole last burst missing. Structural (a call inside the pump), so the revert stays
// a comment.

import { expect, test } from 'bun:test'

import { GET, reactive } from '#server'
import type { App } from '#server/createApp.ts'
import { streamOverMux } from '#server/streamOverMux.ts'
import { PARKED_ADDRESS } from '#shared/ADDRESSES.ts'
import { CONTINUE_HEADER } from '#shared/CONTINUE_HEADER.ts'
import { CONTINUE_KEY } from '#shared/CONTINUE_KEY.ts'
import { chunksOfStream } from '#shared/reactive/producer.ts'

import { inMemoryApp } from './inMemoryApp.ts'

const ORIGIN = 'http://stream-end.test'
const ADDRESS = `${ORIGIN}/feed/ticks`
const COOKIE = 'abide-caller=ada'
// How many early calls the http leg handed to the mux, so that lane is shown to have crossed over.
let handoffs = 0

// The run the handler answers with; each case swaps in its own.
let current: unknown
const ticks = GET(() => current)

/** A `global` stream of `count` chunks, each released by the test, returning as it yields its last. */
function gatedStream(count: number): {
    value: unknown
    release(index: number): void
} {
    const releases: (() => void)[] = []
    const gates: Promise<void>[] = []
    for (let index = 0; index < count; index += 1)
        gates.push(new Promise((resolve) => releases.push(resolve)))
    const value = reactive(
        async function* () {
            for (let index = 0; index < count; index += 1) {
                await gates[index]
                yield index
            }
        },
        { global: true },
    )
    return { value, release: (index) => releases[index]?.() }
}

const nextTask = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve))

function parsedLines(text: string): unknown[] {
    const lines: unknown[] = []
    for (const line of text.split('\n'))
        if (line !== '') lines.push(JSON.parse(line))
    return lines
}

/** What the mux sends for the call `named`, as the browser's reader joins its frames' text. */
async function overMux(
    app: App,
    named: string,
    token?: string,
): Promise<string> {
    let text = ''
    let ended: () => void = () => {}
    const end = new Promise<void>((resolve) => (ended = resolve))
    const carrier = {
        peer: {
            send(_id: number, frame: { op: string; body: string | undefined }) {
                if (frame.op === 'lines')
                    text += JSON.parse(frame.body as string)
                if (
                    frame.op === 'end' ||
                    frame.op === 'error' ||
                    frame.op === 'http'
                )
                    ended()
                return 1
            },
            close() {},
        },
        drained: () => Promise.resolve(),
    }
    const ending = new AbortController()
    void streamOverMux(
        carrier,
        1,
        named,
        new Request(`${ORIGIN}/__abide/socket`, {
            headers: { cookie: COOKIE },
        }),
        (request) => app.fetch(request),
        ending.signal,
        token,
    )
    await end
    return text
}

/** An early call: over http to its first chunk, then the token's rest over the mux (16.97). */
async function handedOver(app: App): Promise<string> {
    const http = await app.fetch(
        new Request(ADDRESS, {
            headers: {
                accept: 'application/x-ndjson',
                cookie: COOKIE,
                [CONTINUE_HEADER]: '1',
            },
        }),
    )
    let text = ''
    for (const line of (await http.text()).split('\n')) {
        if (line === '') continue
        const parsed = JSON.parse(line) as Record<string, unknown> | number
        if (
            typeof parsed === 'object' &&
            parsed !== null &&
            CONTINUE_KEY in parsed
        ) {
            handoffs += 1
            return (
                text +
                (await overMux(
                    app,
                    PARKED_ADDRESS,
                    parsed[CONTINUE_KEY] as string,
                ))
            )
        }
        text += `${line}\n`
    }
    return text
}

type Lane = (app: App, value: unknown) => Promise<unknown[]>

const LANES: Record<string, Lane> = {
    async 'for await over a forwarding value'(_app, value) {
        const forwarding = reactive(
            () => value as never,
        ) as unknown as AsyncIterable<unknown>
        const read: unknown[] = []
        for await (const chunk of forwarding) read.push(chunk)
        return read
    },
    async 'await of a forwarding value'(_app, value) {
        return (await reactive(() => value as never)) as unknown[]
    },
    async 'the wire’s chunks of a forwarding value'(_app, value) {
        const read: unknown[] = []
        for await (const chunk of chunksOfStream(
            reactive(() => value as never),
        ))
            read.push(chunk)
        return read
    },
    async http(app) {
        const answer = await app.fetch(
            new Request(ADDRESS, {
                headers: { accept: 'application/x-ndjson' },
            }),
        )
        return parsedLines(await answer.text())
    },
    async mux(app) {
        return parsedLines(await overMux(app, '/feed/ticks'))
    },
    async 'http, handed to the mux'(app) {
        return parsedLines(await handedOver(app))
    },
}

/** mulberry32: a seeded draw, so a failing case names the seed that reproduces it. */
function seeded(seed: number): () => number {
    let state = seed
    return () => {
        state = (state + 0x6d2b79f5) | 0
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
    }
}

// A random chunk count, a random join point, and the rest released in random bursts — several in
// one turn, so a chunk lands with the handoff's own race (16.97) as well as with the close.
test('a reader joining a run mid-way reads every chunk it produced, on every lane — 9.17', async () => {
    await using app = await inMemoryApp({
        'feed/ticks.handler.ts': { default: ticks },
    })
    const short: string[] = []
    let cases = 0
    for (const [lane, read] of Object.entries(LANES))
        for (let seed = 1; seed <= 18; seed += 1) {
            const draw = seeded(seed)
            const count = 1 + Math.floor(draw() * 6)
            const joinAt = Math.floor(draw() * count)
            const { value, release } = gatedStream(count)
            current = value
            void (value as PromiseLike<unknown>).then(undefined, () => {})
            let released = 0
            while (released < joinAt) release(released++)
            await nextTask()
            const reading = read(app, value)
            while (released < count) {
                const burst = 1 + Math.floor(draw() * 3)
                for (
                    let index = 0;
                    index < burst && released < count;
                    index += 1
                )
                    release(released++)
                await nextTask()
            }
            const expected = Array.from({ length: count }, (_, index) => index)
            const received = await reading
            cases += 1
            if (!Bun.deepEquals(received, expected))
                short.push(
                    `${lane}, seed ${seed}: ${JSON.stringify(received)} of ${JSON.stringify(expected)}`,
                )
        }
    expect(short).toEqual([])
    expect(`cases: ${cases}, handed to the mux: ${handoffs > 0}`).toBe(
        'cases: 108, handed to the mux: true',
    )
})

// 9.15 BEHIND 9.17 — a run that throws in the turn of its last yield hands a forwarding reader every
// chunk before the throw. THE REVERT: drop the `tellOwed` in `pump`'s catch, and `read: [0,1]` where
// `[0,1,2]` is due.
test('a run failing as it yields its last chunk throws after every chunk it produced — 9.15, 9.17', async () => {
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const value = reactive(
        async function* () {
            yield 0
            yield 1
            await gate
            yield 2
            throw new Error('the feed broke')
        },
        { global: true },
    )
    void (value as PromiseLike<unknown>).then(undefined, () => {})
    await nextTask()
    const read: unknown[] = []
    const reading = (async () => {
        try {
            for await (const chunk of reactive(
                () => value as never,
            ) as unknown as AsyncIterable<unknown>)
                read.push(chunk)
        } catch (thrown) {
            return (thrown as Error).message
        }
    })()
    release()
    expect(`thrown: ${await reading}, read: ${JSON.stringify(read)}`).toBe(
        'thrown: the feed broke, read: [0,1,2]',
    )
})
