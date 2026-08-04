// THE REACTIVE / STREAM / CHANNEL PRIMITIVE BENCH RECIPES — the baseline for ADR 0023.
//
// `serverBenches.ts` covers route classification, cache-key building and the warm scalar memo read.
// This file covers the six hot paths that ADR 0023 restructures and that had ZERO measurement before it:
// the state substrate, the probe/read surface (`peek`/`pending`/`chunks`/`done`), stream chunk push,
// `memo.watch` fire cost, channel publish fanout, and the per-chunk frame codec.
//
// Why these exist: ADR 0023 step 4 puts a `ReactiveReadSurface` interface in front of every probe, step 1
// converts `watch` from a value-change effect into a per-append one, and step 3 replaces jsonl/sse/decode
// with one union codec + dispatcher. All three are per-read or per-message costs. Without a before-number
// a regression in any of them is invisible — `verify` runs no benches.
//
// Batch ops report ns for the WHOLE batch; divide by the batch size in `note` for per-item cost.

import { decodeStreamResponse } from 'abide/shared/internal/decodeStreamResponse'
import { computed, effect, state } from 'abide/shared/internal/reactive'
import { ReplayableStream } from 'abide/shared/internal/replayableStream'
import { Subscriber } from 'abide/shared/internal/subscriber'
import { memo } from 'abide/shared/memo'
import type { ServerBench } from './serverBenches.ts'

const CHUNKS = 1000
const FRAMES = 1000

interface Chunk {
    i: number
    label: string
}

async function* chunkSource(n: number): AsyncGenerator<Chunk> {
    for (let i = 0; i < n; i++) yield { i, label: 'row' }
}

function makeChunks(n: number): Chunk[] {
    const out: Chunk[] = []
    for (let i = 0; i < n; i++) out.push({ i, label: 'row' })
    return out
}

// Resolve after the reactive flush: `set` queues the flush microtask first, so a microtask queued after it
// runs once the effect queue has drained. That puts observer re-runs INSIDE the measured op.
function afterFlush(): Promise<void> {
    return new Promise((resolve) => {
        queueMicrotask(resolve)
    })
}

// Attach `count` effects to a state and return a disposer, so fanout cost is the only variable.
function attachObservers(source: () => unknown, count: number): () => void {
    const disposers: Array<() => void> = []
    for (let i = 0; i < count; i++) {
        disposers.push(
            effect(() => {
                source()
            }),
        )
    }
    return () => {
        for (const dispose of disposers) dispose()
    }
}

export async function createReactiveBenches(): Promise<ServerBench[]> {
    // ── state substrate ────────────────────────────────────────────────────────────────────────────
    const readState = state(0)
    const setState1 = state(0)
    const setState10 = state(0)
    const setState100 = state(0)
    attachObservers(setState1, 1)
    attachObservers(setState10, 10)
    attachObservers(setState100, 100)

    // 5-deep computed chain: `set` marks the head DIRTY and the tail CHECK; reading the tail walks the
    // chain through `updateIfNecessary`. This is the glitch-free pull cost.
    const chainHead = state(0)
    let chainLink: () => number = chainHead
    for (let depth = 0; depth < 5; depth++) {
        const previous = chainLink
        chainLink = computed(() => previous() + 1)
    }
    const chainTail = chainLink
    let chainSeed = 0

    // ── probe surface (warm scalar slot) ────────────────────────────────────────────────────────────
    const scalar = memo<{ id: number }, number>((a) => a.id * 2)
    await scalar({ id: 1 })

    // ── probe surface (retained stream slot) ────────────────────────────────────────────────────────
    // A finite source that settles: with the default ttl (Infinity) the transcript is retained, so the
    // probes read a real 100-chunk transcript rather than an empty one.
    const streamMemo = memo<{ id: number }, AsyncIterable<Chunk>>(() => chunkSource(100))
    for await (const _ of await streamMemo({ id: 1 })) {
        // drain once so the slot holds a settled 100-chunk transcript
    }

    // ── watch: current behaviour, the baseline ADR step 1 changes ───────────────────────────────────
    // On a VALUE memo `watch` fires on actual value change (the dedup at memo.ts:789). On a STREAM memo it
    // never fires today, because a stream slot's `value` is permanently undefined. Both numbers are the
    // before-picture: step 1 makes the stream case fire per append.
    const watched = memo<{ id: number }, number>((a) => a.id)
    await watched({ id: 1 })
    // Written by both watch handlers below and READ by `watch/value-fire`, which fails loudly if the watch
    // never fired — a bench that silently times a no-op is worse than no bench at all.
    let watchSink: number | undefined
    watched.watch({ id: 1 }, (value) => {
        watchSink = value
    })
    // Seeded well clear of the slot's loaded value (`a.id` = 1) so the FIRST publish is a real change —
    // otherwise `watch`'s value-dedup (memo.ts:789) correctly suppresses it and iteration one times nothing.
    let watchSeed = 1000

    // ── channel fanout ──────────────────────────────────────────────────────────────────────────────
    // Subscribers are never drained, so each settles at its 1024 cap and every subsequent push takes the
    // drop-oldest `queue.shift()` branch — the steady state, and the O(n)-at-cap path the ADR flagged.
    const fanout = (count: number): { subscribers: Subscriber<Chunk>[]; message: Chunk } => {
        const subscribers: Subscriber<Chunk>[] = []
        for (let i = 0; i < count; i++) subscribers.push(new Subscriber<Chunk>())
        return { subscribers, message: { i: 0, label: 'row' } }
    }
    const fanout1 = fanout(1)
    const fanout10 = fanout(10)
    const fanout100 = fanout(100)
    for (const set of [fanout1, fanout10, fanout100]) {
        for (let i = 0; i < 1100; i++) for (const s of set.subscribers) s.push(set.message)
    }

    // ── frame codec ─────────────────────────────────────────────────────────────────────────────────
    const frames = makeChunks(FRAMES)
    const jsonlBody = `${frames.map((f) => JSON.stringify(f)).join('\n')}\n`

    // ── hand-written baselines ──────────────────────────────────────────────────────────────────────
    // Plain-JS stand-ins for each primitive: an object field for a state, a callback array for the
    // observer set, an eagerly recomputed function chain for a computed, an array for a transcript, a
    // drop-oldest array for a subscriber queue. Every read lands in `plainSink` so the JIT cannot delete
    // it outright — even so, the cheapest of these sit at the timer's resolution floor, so read those
    // ratios as an order of magnitude rather than a figure.
    let plainSink: unknown
    const plainHolder = { value: 0 }
    const makePlainObservers = (count: number): ((value: number) => void)[] => {
        const observers: ((value: number) => void)[] = []
        for (let i = 0; i < count; i++)
            observers.push((value) => {
                plainSink = value
            })
        return observers
    }
    const plainObservers1 = makePlainObservers(1)
    const plainObservers10 = makePlainObservers(10)
    const plainObservers100 = makePlainObservers(100)

    // The same 5-deep chain with no memoisation and no glitch-freedom: five functions that recompute on
    // every read, which is what you get by hand.
    let plainHead = 0
    let plainLink: () => number = () => plainHead
    for (let depth = 0; depth < 5; depth++) {
        const previous = plainLink
        plainLink = () => previous() + 1
    }
    const plainTail = plainLink
    let plainChainSeed = 0

    // The fields a probe surface reads, with nothing reactive behind them.
    const plainSlot = { value: 2, pending: false, error: undefined as unknown, done: true }
    const plainTranscript = makeChunks(100)

    // Plain queues pre-filled to the same 1024 cap the Subscriber settles at, so every push takes the
    // drop-oldest branch exactly as the real one does.
    const makePlainQueues = (count: number): Chunk[][] => {
        const queues: Chunk[][] = []
        for (let i = 0; i < count; i++) {
            const queue: Chunk[] = []
            for (let n = 0; n < 1024; n++) queue.push({ i: n, label: 'row' })
            queues.push(queue)
        }
        return queues
    }
    const plainQueues1 = makePlainQueues(1)
    const plainQueues10 = makePlainQueues(10)
    const plainQueues100 = makePlainQueues(100)
    const plainMessage: Chunk = { i: 0, label: 'row' }
    const pushPlainQueues = (queues: Chunk[][]): void => {
        for (const queue of queues) {
            if (queue.length >= 1024) queue.shift()
            queue.push(plainMessage)
        }
    }

    // Replay a settled transcript to a consumer over the async-iteration protocol — the same shape the
    // real cursor has, minus the stream.
    async function* replayPlain(items: Chunk[]): AsyncGenerator<Chunk> {
        for (const item of items) yield item
    }

    return [
        {
            group: 'state',
            name: 'get',
            note: 'untracked read (currentObserver null)',
            run: () => {
                readState()
            },
            baseline: {
                note: 'plain object field read',
                run: () => {
                    plainSink = plainHolder.value
                },
            },
        },
        {
            group: 'state',
            name: 'set-flush-1',
            note: 'set + flush, 1 observer',
            run: async () => {
                setState1.set(setState1.peek() + 1)
                await afterFlush()
            },
            baseline: {
                note: 'assign a field, call 1 callback',
                run: async () => {
                    plainHolder.value++
                    for (const observer of plainObservers1) observer(plainHolder.value)
                    await afterFlush()
                },
            },
        },
        {
            group: 'state',
            name: 'set-flush-10',
            note: 'set + flush, 10 observers',
            run: async () => {
                setState10.set(setState10.peek() + 1)
                await afterFlush()
            },
            baseline: {
                note: 'assign a field, call 10 callbacks',
                run: async () => {
                    plainHolder.value++
                    for (const observer of plainObservers10) observer(plainHolder.value)
                    await afterFlush()
                },
            },
        },
        {
            group: 'state',
            name: 'set-flush-100',
            note: 'set + flush, 100 observers',
            run: async () => {
                setState100.set(setState100.peek() + 1)
                await afterFlush()
            },
            baseline: {
                note: 'assign a field, call 100 callbacks',
                run: async () => {
                    plainHolder.value++
                    for (const observer of plainObservers100) observer(plainHolder.value)
                    await afterFlush()
                },
            },
        },
        {
            group: 'state',
            name: 'computed-chain-5',
            note: 'set head → read tail through 5 computeds',
            run: () => {
                chainHead.set(++chainSeed)
                chainTail()
            },
            baseline: {
                note: '5 chained functions, recomputed on read',
                run: () => {
                    plainHead = ++plainChainSeed
                    plainSink = plainTail()
                },
            },
        },

        {
            group: 'probe',
            name: 'peek-scalar',
            note: 'warm value slot (ADR step 4 wraps this)',
            run: () => {
                scalar.live({ id: 1 })
            },
            baseline: {
                note: 'plain object field read',
                run: () => {
                    plainSink = plainSlot.value
                },
            },
        },
        {
            group: 'probe',
            name: 'pending-scalar',
            note: 'warm value slot',
            run: () => {
                scalar.pending({ id: 1 })
            },
            baseline: {
                note: 'plain object field read',
                run: () => {
                    plainSink = plainSlot.pending
                },
            },
        },
        {
            group: 'probe',
            name: 'error-scalar',
            note: 'warm value slot',
            run: () => {
                scalar.error({ id: 1 })
            },
            baseline: {
                note: 'plain object field read',
                run: () => {
                    plainSink = plainSlot.error
                },
            },
        },
        {
            group: 'probe',
            name: 'peek-stream',
            note: 'latest chunk of a 100-chunk transcript',
            run: () => {
                streamMemo.live({ id: 1 })
            },
            baseline: {
                note: 'last element of an array',
                run: () => {
                    plainSink = plainTranscript[plainTranscript.length - 1]
                },
            },
        },
        {
            group: 'probe',
            name: 'chunks-stream',
            note: '100-chunk transcript — slice() copy per call',
            run: () => {
                streamMemo.chunks({ id: 1 })
            },
            baseline: {
                note: 'array.slice() copy',
                run: () => {
                    plainSink = plainTranscript.slice()
                },
            },
        },
        {
            group: 'probe',
            name: 'done-stream',
            note: '100-chunk settled transcript',
            run: () => {
                streamMemo.done({ id: 1 })
            },
            baseline: {
                note: 'plain object field read',
                run: () => {
                    plainSink = plainSlot.done
                },
            },
        },

        {
            group: 'stream',
            name: 'push-raw',
            note: `fresh ReplayableStream, ${CHUNKS} pushes/op (no memo hooks)`,
            run: () => {
                const stream = new ReplayableStream<Chunk>()
                for (let i = 0; i < CHUNKS; i++) stream.push({ i, label: 'row' })
                stream.close()
            },
            baseline: {
                note: `fresh array, ${CHUNKS} pushes/op`,
                run: () => {
                    const buffer: Chunk[] = []
                    for (let i = 0; i < CHUNKS; i++) buffer.push({ i, label: 'row' })
                    plainSink = buffer
                },
            },
        },
        {
            group: 'stream',
            name: 'memo-drain',
            note: `${CHUNKS} chunks through a memo slot/op (incl. tick + byte accounting)`,
            run: async () => {
                const draining = memo<{ id: number }, AsyncIterable<Chunk>>(() =>
                    chunkSource(CHUNKS),
                )
                for await (const _ of await draining({ id: 1 })) {
                    // drain: exercises push → bumpStreamTick → accountStreamChunk → consume()
                }
            },
            baseline: {
                note: `raw async-generator drain, ${CHUNKS} chunks/op (no memo)`,
                run: async () => {
                    for await (const chunk of chunkSource(CHUNKS)) plainSink = chunk
                },
            },
        },
        {
            group: 'stream',
            name: 'consume-replay',
            note: `fresh cursor over a settled ${CHUNKS}-chunk transcript`,
            run: async () => {
                const stream = new ReplayableStream<Chunk>()
                for (let i = 0; i < CHUNKS; i++) stream.push({ i, label: 'row' })
                stream.close()
                for await (const _ of stream.consume()) {
                    // replay-only drain
                }
            },
            baseline: {
                note: `array fill + async-generator replay of ${CHUNKS} items`,
                run: async () => {
                    const buffer: Chunk[] = []
                    for (let i = 0; i < CHUNKS; i++) buffer.push({ i, label: 'row' })
                    for await (const chunk of replayPlain(buffer)) plainSink = chunk
                },
            },
        },

        {
            group: 'watch',
            name: 'value-fire',
            note: 'publish + flush on a watched value slot (fires once)',
            run: async () => {
                watchSink = undefined
                watched.publish({ id: 1 }, ++watchSeed)
                await afterFlush()
                if (watchSink === undefined)
                    throw new Error(
                        'watch/value-fire: handler never fired — bench measures nothing',
                    )
            },
            baseline: {
                note: 'assign a field, call the handler directly',
                run: async () => {
                    plainHolder.value = ++plainChainSeed
                    for (const observer of plainObservers1) observer(plainHolder.value)
                    await afterFlush()
                },
            },
        },
        {
            group: 'watch',
            name: 'stream-baseline',
            note: `${CHUNKS} chunks under a watch — fires once per append`,
            run: async () => {
                let fired = 0
                const watchedStream = memo<{ id: number }, AsyncIterable<Chunk>>(() =>
                    chunkSource(CHUNKS),
                )
                watchedStream.watch({ id: 1 }, (value) => {
                    fired++
                    watchSink = (value as Chunk | undefined)?.i
                })
                for await (const _ of await watchedStream({ id: 1 })) {
                    // drain under an attached watch
                }
                // LOUD, like `watch/value-fire` — and this is why that guard is not optional. The note
                // above read "fires 0× TODAY (step 1 changes this)" long after step 1 landed and the
                // watch began firing per append: the human-facing bench table said this ratio was pure
                // attach overhead with no fan-out while `gate.ts` recorded the exact opposite, and a
                // reader trusting the table would go hunting the wrong layer. Nothing announced the flip
                // because nothing asserted the behaviour. An observer that never fires also
                // distinguishes no implementation from any other, so 0 is not a slow bench — it is a
                // bench measuring nothing.
                if (fired === 0)
                    throw new Error(
                        'watch/stream-baseline: watch never fired — bench measures nothing',
                    )
            },
            baseline: {
                note: `raw drain with a per-chunk callback, ${CHUNKS} chunks/op`,
                run: async () => {
                    const observer = plainObservers1[0]!
                    for await (const chunk of chunkSource(CHUNKS)) observer(chunk.i)
                },
            },
        },

        {
            group: 'fanout',
            name: 'push-1',
            note: '1 subscriber at cap (drop-oldest branch)',
            run: () => {
                for (const s of fanout1.subscribers) s.push(fanout1.message)
            },
            baseline: {
                note: '1 array at cap: shift + push',
                run: () => {
                    pushPlainQueues(plainQueues1)
                },
            },
        },
        {
            group: 'fanout',
            name: 'push-10',
            note: '10 subscribers at cap',
            run: () => {
                for (const s of fanout10.subscribers) s.push(fanout10.message)
            },
            baseline: {
                note: '10 arrays at cap: shift + push',
                run: () => {
                    pushPlainQueues(plainQueues10)
                },
            },
        },
        {
            group: 'fanout',
            name: 'push-100',
            note: '100 subscribers at cap',
            run: () => {
                for (const s of fanout100.subscribers) s.push(fanout100.message)
            },
            baseline: {
                note: '100 arrays at cap: shift + push',
                run: () => {
                    pushPlainQueues(plainQueues100)
                },
            },
        },

        {
            group: 'codec',
            name: 'jsonl-encode',
            // No baseline: this recipe IS the hand-written version (a bare `JSON.stringify` loop), so it
            // is its own baseline at 1.00× by construction.
            note: `${FRAMES} frames/op → newline-delimited JSON`,
            run: () => {
                const parts: string[] = []
                for (const frame of frames) parts.push(`${JSON.stringify(frame)}\n`)
                parts.join('')
            },
        },
        {
            group: 'codec',
            name: 'jsonl-decode',
            note: `${FRAMES} frames/op ← decodeStreamResponse`,
            run: async () => {
                const response = new Response(jsonlBody, {
                    headers: { 'content-type': 'application/jsonl' },
                })
                for await (const _ of decodeStreamResponse(response)) {
                    // decode-only drain
                }
            },
            baseline: {
                note: `${FRAMES} frames/op ← response.text() → split + JSON.parse`,
                run: async () => {
                    const response = new Response(jsonlBody, {
                        headers: { 'content-type': 'application/jsonl' },
                    })
                    const body = await response.text()
                    for (const line of body.split('\n')) {
                        if (line === '') continue
                        plainSink = JSON.parse(line)
                    }
                },
            },
        },
    ]
}
