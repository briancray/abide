// THE CURSOR. RULEBOOK 2.5: `for await (… of s)` — the production in flight, then each one after
// it. On a streaming producer that is one turn per CHUNK, read from the chunk buffer by ordinal,
// so two chunks between two `await`s are two turns of the loop. On every other value it is the
// standing production: a burst between two turns collapses to the latest, since nothing else is
// held. An app that wants every message keeps them — a channel is an array.
//
// A NARROW FACE rather than the `Cell`, the same way `tracking.ts` takes a `Tracked`: what a
// cursor reads is a handful of fields, and naming them keeps the cell's internals out of a
// second file.

import {
    dropReader,
    newSubscriber,
    type Subscriber,
    type Tracked,
} from './tracking.ts'
import { PATCHES } from './PATCHES.ts'

/**
 * What a cursor reads, and all of a cell the server is handed (`servedCellOf`).
 *
 * `ring[index]` carries ordinal `ringBase + index + 1`, so a cursor holding an ordinal finds its
 * place in a stream's chunk buffer without the buffer having to hold one.
 */
export type Retained = {
    /** The window a `throttle` or a `debounce` holds open, `holding` while a production waits on it. */
    cap: { holding: boolean } | null
    ordinal: number
    /**
     * Unused by a cursor and declared so a `Cell` still satisfies `Tracked`, which a cursor's
     * subscriber is registered through.
     */
    probeReaders: Subscriber[]
    ring: unknown[]
    ringBase: number
    servable: boolean
    state: number
    /**
     * Non-null on a streaming producer, whose ring is the accumulation of the run being served
     * (9.1) and is retained whole — the chunks ARE the value.
     */
    stream: object | null
    value: unknown
    readers: Subscriber[]
}

// The cursors standing over each source, for a patch to keep the place of the ones behind (5.7).
const CURSORS = new WeakMap<Retained, Set<Cursor>>()

/**
 * Keeps each cursor behind `edited` where it stands, as a stream patch grows its accumulation by
 * `grown` and moves the ring's base by as much.
 *
 * THE BASE MOVES FOR A CURSOR CAUGHT UP, so the next chunk lands one past it. One behind that has
 * still to read where the patch wrote reads on from where it was — so its ordinal moves with the
 * base and its place in the ring does not. One the patch wrote before shifts with the ring.
 */
export function keepPlaces(
    source: Retained,
    edited: number,
    grown: number,
): void {
    const cursors = CURSORS.get(source)
    if (cursors === undefined) return
    for (const cursor of cursors)
        if (cursor.at < source.ordinal && cursor.at - source.ringBase <= edited)
            cursor.at -= grown
}

/** Whether a cursor over `source` has chunks it has still to read. */
export function hasCursorBehind(source: Retained): boolean {
    const cursors = CURSORS.get(source)
    if (cursors === undefined) return false
    for (const cursor of cursors) if (cursor.at < source.ordinal) return true
    return false
}

/**
 * A live reader of a source's productions, one turn per production, in order.
 *
 * A RECORD, NOT A SCOPE. The four closures this was — `take`, `notify`, `stop` and `next` — shared
 * one environment holding `at`, `waiting`, `source` and `reader`, and a cursor OUTLIVES the call
 * that made it: a `for await` holds one for the life of the loop, so the environment and every
 * function object hanging off it is live that whole time. Fields on a prototype are the object
 * alone, and `at` — read and written on every turn — becomes a property load on a fixed structure
 * rather than a scope load.
 */
export class Cursor implements AsyncIterator<unknown> {
    source: Retained
    /** The ordinal of the last production this cursor handed over. */
    at: number
    /**
     * The patch epoch the value it last handed over stood at.
     *
     * A PATCH MINTS NO ORDINAL (5.7) — the follow's version tells a patch from a production by
     * exactly that — so a cursor over a value patched in place reads the change off the object.
     */
    patched: number
    /**
     * The turns asked for and not yet answered.
     *
     * A QUEUE rather than one slot because a consumer may ask twice before either answer arrives
     * — `Promise.all([ it.next(), it.next() ])` is the shape, and with one slot the second `next`
     * overwrote the first's resolver and that promise never settled at all. `for await` asks one
     * at a time, which is why nothing here said so.
     */
    waiting: ((result: IteratorResult<unknown>) => void)[]
    reader: Subscriber

    constructor(source: Retained, from: number) {
        this.source = source
        this.at = from
        this.patched = 0
        this.waiting = []
        // The one closure left, and it captures this cursor and nothing else. `notify` is
        // called as a method on the SUBSCRIBER, so it cannot be the cursor's own method —
        // and widening `Subscriber` with a back-edge would put a field on the shape every
        // reader in the graph carries for the sake of the few that are cursors.
        // Registered outside the tracking protocol, so the source it waits on is declared
        // rather than discovered — see the same shape in `Reactive`'s `settled`.
        this.reader = newSubscriber([source as unknown as Tracked], null)
        // One production per waiting turn, in the order they were asked for: a burst that
        // lands three productions on a consumer holding two turns answers both.
        this.reader.notify = (): void => {
            const waiting = this.waiting
            while (waiting.length !== 0) {
                const next = this.take()
                if (next === null) return
                ;(waiting.shift() as (result: IteratorResult<unknown>) => void)(
                    next,
                )
            }
        }
        source.readers.push(this.reader)
        let cursors = CURSORS.get(source)
        if (cursors === undefined) {
            cursors = new Set()
            CURSORS.set(source, cursors)
        }
        cursors.add(this)
    }

    /**
     * One production, or `null` where the cursor has caught up.
     *
     * Reading a stream's chunks by ordinal is what keeps a burst from being a gap or a repeat.
     */
    take(): IteratorResult<unknown> | null {
        const source = this.source
        let at = this.at
        if (source.stream === null) {
            const value = source.value
            // 6.10: an `undefined` standing is caught up, not a turn.
            if (value === undefined) return null
            const patched =
                value !== null && typeof value === 'object'
                    ? (PATCHES.written.get(value) ?? 0)
                    : 0
            if (at >= source.ordinal && patched === this.patched) return null
            // 5.9 — A PRODUCTION A WINDOW HOLDS has minted its ordinal and is not yet the value: the
            // turn is the release's, which wakes this cursor.
            if (source.cap?.holding === true) return null
            // The standing production is the only one held, so everything minted or patched
            // since the last turn collapses into it.
            this.at = source.ordinal
            this.patched = patched
            return { value, done: false }
        }
        if (at >= source.ordinal) return null
        // A run that restarted moved the buffer past this cursor: answer from its start.
        if (at < source.ringBase) at = source.ringBase
        const value = source.ring[at - source.ringBase]
        this.at = at + 1
        return { value, done: false }
    }

    next(): Promise<IteratorResult<unknown>> {
        if (!this.reader.alive)
            return Promise.resolve({ value: undefined, done: true })
        // A TURN ALREADY ASKED FOR AND NOT ANSWERED KEEPS THE ORDER: taking from the
        // ring here while one is queued would hand the later caller the earlier
        // production.
        if (this.waiting.length === 0) {
            const ready = this.take()
            // NOT `async`, and no `await` on the caught-up arm. A cursor behind a
            // stream's chunks is the common shape while a burst drains, and an
            // `async` here would put a microtask tick between every one of those
            // turns.
            if (ready !== null) return Promise.resolve(ready)
        }
        const waiting = this.waiting
        return new Promise((resolve) => {
            waiting.push(resolve)
        })
    }

    /**
     * Ends the cursor: `for await` calls this on `break`, on `return` and on a throw.
     *
     * It is the only thing that drops the subscriber — a live cursor has no end of its own.
     */
    return(): Promise<IteratorResult<unknown>> {
        return this.stop()
    }

    throw(): Promise<IteratorResult<unknown>> {
        return this.stop()
    }

    stop(): Promise<IteratorResult<unknown>> {
        const reader = this.reader
        reader.alive = false
        dropReader(this.source, reader)
        CURSORS.get(this.source)?.delete(this)
        const waiting = this.waiting
        while (waiting.length !== 0)
            (waiting.shift() as (result: IteratorResult<unknown>) => void)({
                value: undefined,
                done: true,
            })
        return Promise.resolve({ value: undefined, done: true })
    }
}
