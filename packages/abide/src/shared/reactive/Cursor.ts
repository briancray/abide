// THE CURSOR. RULEBOOK 2.6: a streaming producer's chunks, read from the chunk buffer by ordinal,
// so two chunks between two `await`s are two turns of the loop, and a patch or a write over the
// stream moves no place (5.7, 9.12). Where the run ENDS is the caller's settling, handed to
// `closeOn`: one run's reader is `Reactive.ts`'s `runChunks`.
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

/**
 * What a cursor reads of a cell.
 *
 * `ring[index]` carries ordinal `ringBase + index + 1`, so a cursor holding an ordinal finds its
 * place in a stream's chunk buffer without the buffer having to hold one.
 */
export type Retained = Tracked & {
    ordinal: number
    ring: unknown[]
    ringBase: number
}

/** What `take` answers when the cursor has caught up — never a chunk, which may be `undefined`. */
export const CAUGHT_UP: unique symbol = Symbol('caught up')

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
 * A reader of a stream's chunks, in order, waking whoever waits on it when one lands.
 *
 * A RECORD, NOT A SCOPE. A cursor outlives the call that made it — a `for await` holds one for the
 * life of the loop — so fields on a prototype are the object alone, and `at`, read and written on
 * every turn, is a property load on a fixed structure rather than a scope load.
 */
export class Cursor {
    source: Retained
    /** The ordinal of the last chunk this cursor handed over. */
    at: number
    /** Called once at the next wake, then cleared. */
    wake: (() => void) | null
    /** Whether the run `closeOn` was handed has settled. */
    closed: boolean
    /** What that run rejected with. */
    failure: unknown
    reader: Subscriber

    constructor(source: Retained, from: number) {
        this.source = source
        this.at = from
        this.wake = null
        this.closed = false
        this.failure = undefined
        // The one closure left, and it captures this cursor and nothing else. `notify` is called as a
        // method on the SUBSCRIBER, so it cannot be the cursor's own method. Registered outside the
        // tracking protocol, so the source it waits on is declared rather than discovered — see the
        // same shape in `Reactive`'s `settled`.
        this.reader = newSubscriber([source], null)
        this.reader.notify = (): void => this.woken()
        source.readers.push(this.reader)
        // ONE PLACED PAST EVERY CHUNK is a wake and never behind, so no patch has a place to keep.
        if (from === Number.POSITIVE_INFINITY) return
        let cursors = CURSORS.get(source)
        if (cursors === undefined) {
            cursors = new Set()
            CURSORS.set(source, cursors)
        }
        cursors.add(this)
    }

    /**
     * The next chunk, or `CAUGHT_UP`.
     *
     * Reading by ordinal is what keeps a burst from being a gap or a repeat.
     */
    take(): unknown {
        const source = this.source
        if (this.at >= source.ordinal) return CAUGHT_UP
        const value = source.ring[this.at - source.ringBase]
        this.at += 1
        return value
    }

    /**
     * Ends the cursor's run where `run` settles: `closed` is set, `failure` holds a rejection, and
     * the current `turn` wakes.
     *
     * ONE REACTION ON THE CLOSE FOR THE WHOLE RUN, never one per chunk held until the run ends. A
     * chunk landing in the same turn as the close is still unread when the close wakes the caller,
     * so a drain before reading `closed` hands it over rather than losing it to whichever settled
     * first.
     */
    closeOn(run: PromiseLike<unknown>): void {
        run.then(
            () => {
                this.closed = true
                this.woken()
            },
            (error: unknown) => {
                this.closed = true
                this.failure = error
                this.woken()
            },
        )
    }

    /** Settles at the next chunk or the close, whichever lands first. */
    turn(): Promise<void> {
        return new Promise((resolve) => {
            this.wake = resolve
        })
    }

    private woken(): void {
        const wake = this.wake
        this.wake = null
        wake?.()
    }

    /** Drops the subscriber; nothing else does. */
    stop(): void {
        const reader = this.reader
        reader.alive = false
        dropReader(this.source, reader)
        CURSORS.get(this.source)?.delete(this)
        this.wake = null
    }
}
