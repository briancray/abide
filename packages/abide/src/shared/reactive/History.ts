// THE CURSOR. RULEBOOK 2.5, 2.6, 2.7, 5.11, 9.10: a reader that wants every production
// rather than the latest one. `s()` answers the latest and nothing else, whatever the
// retention, so this is the only way to what came before it and the only way to take
// productions one at a time, in order, as they arrive.
//
// IT READS THE RING, NOT THE WAKES, and that is the whole reason it is a separate
// mechanism rather than a `watch`. 5.11 has a cursor deliver every production a window
// collapsed that retention still holds, so a cursor that counted wakes would lose
// exactly what `throttle` and `debounce` are going to start collapsing. Position is an
// ORDINAL — the count of productions minted — and the ring is indexed from it, so two
// productions between two `await`s are two turns of the loop.
//
// A NARROW FACE rather than the `Cell`, the same way `tracking.ts` takes a `Tracked`:
// what a cursor reads is a handful of fields, and naming them is what keeps the cell's internals
// out of a second file.

import {
    dropReader,
    newSubscriber,
    type Subscriber,
    type Tracked,
} from './tracking.ts'

/**
 * What `s.history(n)` answers: the retained window to iterate, or to `for await` and follow live.
 *
 * RULEBOOK 6.3: the unit is `Produced`. Both faces, because a consumer that wants what is already
 * held should not have to `await` for it — the sync face is the retained window and stops, the
 * async face replays that window and then continues live.
 */
export type History<Produced> = Iterable<Produced> & AsyncIterable<Produced>

/**
 * What a cursor reads.
 *
 * `ringBase` is the count of productions that have fallen off the front, so `ring[index]` carries
 * ordinal `ringBase + index + 1` and a cursor holding an ordinal can find its place without the
 * ring having to hold one.
 */
export type Retained = {
    ordinal: number
    /**
     * Unused by a cursor and declared so a `Cell` still satisfies `Tracked`, which a cursor's
     * subscriber is registered through.
     */
    probeReaders: Subscriber[]
    ring: unknown[]
    ringBase: number
    /**
     * `history + 1` where a value declares `history`, and 0 where it declares none.
     *
     * With none, the standing production is the whole of what is retained, answered from `value`
     * (6.16).
     */
    ringDepth: number
    servable: boolean
    /**
     * Non-null on a streaming producer, whose ring is the accumulation of the run being served
     * (9.2) and is retained whole — the chunks ARE the value.
     */
    stream: object | null
    value: unknown
    readers: Subscriber[]
}

/**
 * How many productions back this source can actually answer.
 *
 * 2.6 bounds a replay above by what is retained, and the ring runs up to twice the depth between
 * trims, so the window is its window's end rather than its length.
 */
export function retained(source: Retained): number {
    if (source.stream !== null) return source.ring.length
    if (source.ringDepth === 0)
        return source.servable &&
            source.ordinal > 0 &&
            source.value !== undefined
            ? 1
            : 0
    return source.ring.length < source.ringDepth
        ? source.ring.length
        : source.ringDepth
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
class Cursor implements AsyncIterator<unknown> {
    source: Retained
    /** The ordinal of the last production this cursor handed over. */
    at: number
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
    }

    /**
     * One production, or `null` where the cursor has caught up.
     *
     * Reading the ring by ordinal is what makes 2.5's "no gap and no repeat" hold across the join
     * between the replay and the live tail: there is no join, only a position.
     */
    take(): IteratorResult<unknown> | null {
        const source = this.source
        let at = this.at
        if (at >= source.ordinal) return null
        if (source.ringDepth === 0 && source.stream === null) {
            // 6.19: an `undefined` standing is caught up, not a turn.
            if (source.value === undefined) return null
            // Nothing is retained, so the only production a cursor can be handed is the
            // one standing. Everything minted since its last turn has been collapsed by
            // the absence of a ring, which is 5.11's "that retention still holds".
            this.at = source.ordinal
            return { value: source.value, done: false }
        }
        // 9.10: a cursor older than the ring is answered with the whole ring rather than
        // with a gap. It has missed productions either way; what it must not do is
        // report them as delivered.
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
            // NOT `async`, and no `await` on the caught-up arm. A cursor that is
            // behind the ring is the common shape while a replay drains, and an
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
        const waiting = this.waiting
        while (waiting.length !== 0)
            (waiting.shift() as (result: IteratorResult<unknown>) => void)({
                value: undefined,
                done: true,
            })
        return Promise.resolve({ value: undefined, done: true })
    }
}

/**
 * What `s.history(n)` hands back, and what `s[Symbol.asyncIterator]` is built from.
 *
 * `from` is an ordinal: the cursor's first turn carries the production after it.
 *
 * A RECORD RATHER THAN AN OBJECT LITERAL CLOSING OVER THE TWO, and the difference is four
 * allocations against one: two methods capturing `source` and `from` allocate the scope, a
 * function object each and the object itself, where two fields on a prototype allocate the object
 * alone. `history()` is called once per read of a window — the walk case calls it per row — and
 * measured on its own the literal cost 71.4 ns against a 358 ns op.
 */
class HistoryWindow<Produced> implements History<Produced> {
    source: Retained
    from: number

    constructor(source: Retained, from: number) {
        this.source = source
        this.from = from
    }

    /**
     * The sync face: what is already held, and then it stops.
     *
     * It cannot wait, so it is the window rather than the cursor.
     *
     * INDEXED FROM THE ORDINAL, like the cursor, and read at ITERATION rather than at
     * `history()`. A depth captured when the window was made is the wrong window the moment
     * anything publishes into it: `s.history(2)` over two productions and then a third handed
     * back the LAST two — dropping one the position says to replay and including one that landed
     * after the call — where the async face of the same object replayed all three. One position,
     * two faces, or they are two answers.
     *
     * THE WINDOW IS COPIED AND JSC'S OWN ARRAY ITERATOR WALKS IT, which reads as the wasteful arm
     * and is the measured one. An index walk over the ring in place skips the copy and costs 258
     * ns against this shape's 136 over a hundred entries: the builtin iterator's result record is
     * sunk by the JIT and a hand-written `next` returning `{ value, done }` allocates one per
     * entry. Reusing one mutable record across the turns does win — 108 ns — and is not available
     * to a public iterator, where two `next()` results a caller holds at once must be two objects.
     */
    [Symbol.iterator](): Iterator<Produced> {
        const source = this.source
        const from = this.from
        if (from >= source.ordinal) return ([] as Produced[])[Symbol.iterator]()
        // 6.16: with no ring, the standing production is the whole window.
        if (source.ringDepth === 0 && source.stream === null)
            return (
                (source.value === undefined ? [] : [source.value]) as Produced[]
            )[Symbol.iterator]()
        // 9.10: a position older than the ring is answered with the whole ring rather
        // than with a gap, which is the same clamp the cursor makes.
        const start = from < source.ringBase ? 0 : from - source.ringBase
        const window = source.ring.slice(start)
        return (window as Produced[])[Symbol.iterator]()
    }

    [Symbol.asyncIterator](): AsyncIterator<Produced> {
        // A FRESH CURSOR PER ITERATION, from the same place. Two `for await` loops
        // over one `s.history(10)` are two readers of the same ten productions, not one
        // reader they take turns draining.
        return new Cursor(this.source, this.from) as AsyncIterator<Produced>
    }
}

/** The `History` over `source`'s productions after ordinal `from`. */
export function historyFrom<Produced>(
    source: Retained,
    from: number,
): History<Produced> {
    return new HistoryWindow(source, from)
}
