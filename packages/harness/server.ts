// What a render cost on the SERVER, where there is no engine to ask.
//
// The browser lane counts what Blink did — style, layout, paint. None of that exists here: a server
// render produces bytes, and the only questions worth asking about it are how many bytes, how long,
// how many microtask turns it cost to make them, and what it allocated on the way.
//
// The last two are the ones nothing else can see. A walk that produces the right markup at ten times
// the microtask cost passes every correctness test in this repo — an async generator handing back a
// promise for a chunk it ALREADY HAS costs about seven turns per row, and the string is identical. So
// this reports the turns, which is the second of the three numbers this project budgets emitted code
// in, taken on the substrate the walk actually runs on.
//
// Bun-only, and that is why it is its own entry point rather than part of `harness/measure`:
// `heapStats` is `bun:jsc` and `measure` must stay importable by a browser page, which is the whole
// reason that half has no dependencies at all.

import { heapStats } from 'bun:jsc'

/** What one server render cost. Every field is a DELTA across the work, never a running total. */
export interface ServerWork {
    /** Bytes of markup produced, measured as UTF-8 rather than as string length. */
    bytes: number
    /** Milliseconds to produce them. */
    ms: number
    /**
     * Microtask TURNS the walk cost, with the floor of an empty async function already subtracted.
     *
     * So this is what the work OWES rather than what it was charged. A negative reading is rounded to
     * zero: the floor is itself a measurement and can land above a walk that awaited nothing.
     */
    microtasks: number
    /**
     * Objects allocated by JSC type, for the types that MOVED. Absent types allocated nothing.
     *
     * What this counts is ALLOCATION, not retention: most of what a walk makes dies immediately — an
     * iterator over an observer set outlives nothing — and the cost of that allocation is that it
     * happened, not that it survived. Asking what is still reachable is a different question, and
     * `Memory.getDOMCounters` in `harness/engine` is where that one is asked.
     *
     * NOTHING IS COLLECTED HERE, in either direction. A collection landing between the two readings
     * can only UNDER-count, so the number fails towards passing and never invents work that did not
     * happen. That is the one contaminant, it runs one way, and `serverWorkOver` is the answer to it.
     */
    allocated: Record<string, number>
}

/** What the walk can hand back: a string, a promise of one, or the chunks of a streaming render. */
export type Produced = string | Promise<string> | AsyncIterable<string> | Iterable<string>

const ENCODER = new TextEncoder()

/** Objects JSC allocates for the measurement itself, which would otherwise read as the walk's. */
const HARNESS_OWN = new Set(['Promise', 'JSMicrotask'])

function typeCounts(): Record<string, number> {
    return heapStats().objectTypeCounts as Record<string, number>
}

/**
 * Drain whatever the render handed back, counting bytes.
 *
 * Concatenation is deliberately absent: a walk producing a thousand chunks would be measured against
 * a quadratic buffer of this harness's own making, and on V8 a cons-string plus `indexOf` was 20x.
 * Bytes accumulate per chunk and the string is never held.
 */
async function drain(produced: Produced): Promise<number> {
    if (typeof produced === 'string') return ENCODER.encode(produced).byteLength
    if (produced instanceof Promise) return ENCODER.encode(await produced).byteLength

    let bytes = 0
    if (Symbol.asyncIterator in produced) {
        for await (const chunk of produced as AsyncIterable<string>) bytes += ENCODER.encode(chunk).byteLength
        return bytes
    }
    for (const chunk of produced as Iterable<string>) bytes += ENCODER.encode(chunk).byteLength
    return bytes
}

/**
 * Count microtask turns while `work` is in flight.
 *
 * A self-rescheduling microtask cannot starve the work — the queue is FIFO, so the counter and the
 * walk interleave. Its own copy rather than `harness/measure`'s, because that half must stay free of
 * anything bun-only and this file is already the bun-only one; importing across would tie the two
 * together for six lines.
 */
async function turnsOf(work: () => Promise<unknown>): Promise<number> {
    let turns = 0
    let counting = true
    const tick = (): void => {
        if (!counting) return
        turns++
        queueMicrotask(tick)
    }
    queueMicrotask(tick)
    await work()
    counting = false
    return turns
}

/**
 * What one server render cost, in the four numbers a server render has.
 *
 * The allocation reading brackets the WHOLE call including the drain, because the chunks are the
 * walk's output and the strings it made to produce them are part of what it cost.
 */
export async function serverWork(render: () => Produced): Promise<ServerWork> {
    // The floor first, so an empty async function's own turns are not charged to the walk. Taken
    // before the sample below rather than after, so its allocations are not either.
    const floor = await turnsOf(async () => undefined)

    const before = typeCounts()
    const started = performance.now()
    let bytes = 0
    const microtasks = await turnsOf(async () => {
        bytes = await drain(render())
    })
    const ms = performance.now() - started
    const after = typeCounts()

    const allocated: Record<string, number> = {}
    for (const kind of Object.keys(after)) {
        if (HARNESS_OWN.has(kind)) continue
        const moved = (after[kind] ?? 0) - (before[kind] ?? 0)
        if (moved > 0) allocated[kind] = moved
    }

    return { bytes, ms, microtasks: Math.max(0, microtasks - floor), allocated }
}

/**
 * The same reading over `trials` runs, each field taken at its LEAST CONTAMINATED end.
 *
 * A COMPOSITE, and named as one: no single run necessarily produced all of these numbers together.
 * That is the honest shape because the contaminants differ per field and every one of them runs in a
 * known direction, so "the best run" is not one run.
 *
 *   · `microtasks` — MAX. A timer cannot interleave the microtask awaits it would need to inflate
 *     this, so nothing can push it up; only a scheduler quirk can push it down.
 *   · `allocated` — MAX per type. Only a collection moves it, and only downwards.
 *   · `ms` — MIN. The one field whose contaminant is the other way round: every interruption makes
 *     a wall-clock reading longer, never shorter.
 *   · `bytes` — the first run's. It is a property of the markup, not of the measurement, and a walk
 *     that produced different bytes on two runs is a bug this would otherwise average away — so a
 *     disagreement THROWS rather than being reconciled.
 */
export async function serverWorkOver(render: () => Produced, trials = 3): Promise<ServerWork> {
    const first = await serverWork(render)
    const composite: ServerWork = { ...first, allocated: { ...first.allocated } }

    for (let at = 1; at < trials; at++) {
        const reading = await serverWork(render)
        if (reading.bytes !== composite.bytes) {
            throw new Error(`harness: the render produced ${reading.bytes} bytes and then ${composite.bytes}`)
        }
        if (reading.microtasks > composite.microtasks) composite.microtasks = reading.microtasks
        if (reading.ms < composite.ms) composite.ms = reading.ms
        for (const kind of Object.keys(reading.allocated)) {
            const seen = reading.allocated[kind] as number
            if (seen > (composite.allocated[kind] ?? 0)) composite.allocated[kind] = seen
        }
    }
    return composite
}
