// The ceilings on what abide REMEMBERS, and the one law all three are built to keep.
//
// A cap on retention must not become a cost on every write. `channel({ tail })` established that
// shape already — the buffer is pushed into and compacted once per `tail` messages, so raising a
// scrollback costs a publish nothing — and these are the same law over the three other places a
// process grows without anyone deciding it should: a stream's TRANSCRIPT, the memo cache that
// belongs to the PROCESS rather than to a caller, and how long a streaming render may run.
//
// All three are unset by default, and unset has to be free. The env read is where each ceiling is
// declared — once per stream, once per settle, once per render that waits — so a process that
// declared none pays one property read at each of those three moments and nothing at all on the
// paths in between: no charge, no LRU, no bookkeeping per chunk, none per select, and not even the
// timer the render budget would arm.
//
// Read where the ceiling could first matter rather than latched at import, for the reason
// `ABIDE_LOGS` and `ABIDE_LOG_BUFFER` are: a knob only readable before the module loaded is one an
// app cannot set from its own entry point, and one a test cannot exercise at all.
//
// A byte here is CHARGED, not measured. There are two charges below and they differ because the two
// MOMENTS differ, not because they disagree about what a byte is: a chunk's charge runs inside a
// stream's hot loop and is O(1) by contract, while a slot's runs once behind a load that already did
// real work and may walk the value. A charge that had to be exact would be the per-write cost the
// ceiling exists to avoid.

import { abideLog } from '../log.ts'
import { numberKnob } from './knobs.ts'
import { NO_LIMIT } from './timers.ts'

const streamLog = abideLog.channel('stream')

/**
 * What a value abide cannot size in the budget it has is charged.
 *
 * Something rather than nothing, deliberately: a slot charged zero is one the ceiling could never
 * evict, so an unmeasurable value would be the one thing that made the cap unenforceable.
 */
const UNSIZED = 64

/** Per-stream transcript cap. Declared once per stream, so nothing per chunk reads the environment. */
export function streamCeiling(): number {
    return numberKnob('ABIDE_MAX_STREAM_BUFFER_SIZE')
}

/**
 * The charges both budgets answer EXACTLY and in O(1) — a string and the two binary shapes.
 *
 * `-1` where neither matches, so the caller decides what an unanswerable value costs: a chunk is
 * charged the flat overhead, a slot is worth a walk. That is the whole of what the two budgets
 * disagree about, and it is one branch rather than two copies of these three lines.
 */
function exactCharge(value: unknown): number {
    if (typeof value === 'string') return value.length
    if (ArrayBuffer.isView(value)) return value.byteLength
    if (value instanceof ArrayBuffer) return value.byteLength
    return -1
}

/**
 * What one chunk is charged against a stream's transcript ceiling.
 *
 * O(1) by contract — this runs on every chunk. A string and a binary chunk are the two shapes a
 * stream actually carries and both answer exactly; anything else is charged the flat overhead rather
 * than stringified, because a `JSON.stringify` per chunk is precisely the per-write cost this is
 * here to bound.
 */
export function chunkCharge(chunk: unknown): number {
    const exact = exactCharge(chunk)
    return exact === -1 ? UNSIZED : exact
}

/**
 * Said once per stream that overflows, not once per chunk after it — the transcript is dropped on
 * the chunk that passed the cap and nothing is charged afterwards, so there is one event to report.
 *
 * A warning rather than a debug line: `DEBUG` gates volume, not breakage, and a transcript that
 * silently went empty is a reader being told the stream produced nothing.
 */
export function reportOverflow(charged: number, ceiling: number): void {
    streamLog.warning(
        `a stream passed ABIDE_MAX_STREAM_BUFFER_SIZE (${ceiling}) at ${charged} charged bytes — its transcript is dropped and chunks() replays nothing for the rest of it`,
    )
}

// --- the process-wide memo cache --------------------------------------------
//
// ONE registry across every memo, because the ceiling is on the cache rather than on any memo in it:
// a per-memo cap would be a number an operator has to multiply by however many memos an app declares
// to learn what the process may hold.
//
// It bounds the GLOBAL and DEFAULT-CONTEXT cache and nothing else — the map a `{ global }` memo uses
// and the one every caller shares when there is no caller scope. A per-caller cache is already
// bounded by the request that owns it, and evicting from one would be answering a memory question
// nobody asked with a cache miss inside a live request.
//
// Recency is the `Set`'s own insertion order: delete-then-add moves an entry to the back, and the
// first entry the iterator hands over is the oldest. A linked list would save the delete; a Set saves
// two pointer fields on every slot in the process, and the delete only happens where a ceiling is set.

/**
 * One cache row's entry in the order, as a CLASS rather than a closure.
 *
 * The cache and the key are copied in, so nothing here captures the scope that built the row — a
 * registry entry outlives the slot's whole construction, and an arrow closing over it would keep
 * every local that construction touched alive with it.
 */
export class Bounded {
    /** What it is charged right now. Zero until it settles, and zero again once it is dropped. */
    charged = 0
    /**
     * The cache has FORGOTTEN this row, so nothing it does afterwards is the cache's business.
     *
     * An entry outlives its row: `handle.set` on a handle the caller kept, and the `.then` of a load
     * that was still in flight when the row was evicted, both hand this back to `admit`. Re-admitted,
     * it sits in the order charged against a row that no longer exists — and when it drains, `evict`
     * deletes its key, which by then belongs to the fresh row that replaced it. That row's entry is
     * still charged, so the next drain does it again, one live row at a time.
     */
    dropped = false
    constructor(
        private readonly cache: Map<string, unknown>,
        private readonly key: string,
        /** Teardown that has to go with the row — a tag registration naming it. */
        public leave: (() => void) | null,
    ) {}

    /**
     * The CACHE forgets this row; the value is not destroyed. Whoever already holds the handle keeps
     * a working cell, and the next select builds a fresh one — which is the whole of what an
     * eviction means. The tag goes with it, or the registry keeps naming a row nothing can reach.
     */
    evict(): void {
        this.dropped = true
        this.cache.delete(this.key)
        this.leave?.()
    }
}

const ORDER = new Set<Bounded>()
let held = 0

/**
 * Charge a slot that has just settled, then evict from the oldest end until the cache is under.
 *
 * The ceiling is re-read HERE, which is the only moment it can change anything: a slot growing the
 * cache is what an operator set the number to stop. Reading it here also means turning the knob off
 * mid-process is honest — the registry drops what it was tracking rather than enforcing a number
 * nobody is asking for any more.
 */
export function admit(entry: Bounded, value: unknown): void {
    // A settle that lands after its row was evicted is charged to nothing: the row it would be
    // charged for is gone, and re-entering the order is how it comes back to delete its successor.
    if (entry.dropped) return
    const ceiling = numberKnob('ABIDE_MAX_GLOBAL_CACHE_SIZE')
    if (ceiling === NO_LIMIT) {
        if (ORDER.size !== 0) {
            for (const tracked of ORDER) tracked.charged = 0
            ORDER.clear()
            held = 0
        }
        return
    }

    held -= entry.charged
    entry.charged = valueCharge(value)
    held += entry.charged
    ORDER.delete(entry)
    ORDER.add(entry) // newest at the back, so the iterator's first is the least recently used

    // ONE iterator across the whole drain. A fresh `ORDER.values()` per eviction has to walk the
    // tombstones the previous deletes left behind, which makes a burst — a big value landing, or an
    // operator LOWERING the number — quadratic in the rows it drops. That is the trap the transcript
    // climbed out of once, and a cap that pays it is a cap costing more than what it bounds.
    if (held > ceiling) {
        const oldest = ORDER.values()
        while (held > ceiling) {
            const next = oldest.next()
            if (next.done === true) break
            const entry = next.value
            ORDER.delete(entry)
            held -= entry.charged
            entry.charged = 0
            entry.evict()
        }
    }
}

/**
 * This slot was just asked for. Nothing else about an LRU is a read's business.
 *
 * A slot that has not settled is charged nothing and cannot be evicted, so it is not in the order to
 * move — and a charge is only ever non-zero where a ceiling was set, so that one field read is the
 * whole of what a select costs when nothing bounds the cache.
 */
export function touch(entry: Bounded): void {
    if (entry.charged === 0) return
    ORDER.delete(entry)
    ORDER.add(entry)
}

/** It holds nothing now — invalidated, failed, or evicted. Charged nothing, so it evicts nothing. */
export function release(entry: Bounded): void {
    if (entry.charged === 0) return
    held -= entry.charged
    entry.charged = 0
    ORDER.delete(entry)
}

/**
 * What a settled slot is charged against the process-wide ceiling.
 *
 * This may WALK the value, unlike a chunk's charge: it runs once per settle, behind a load that
 * already went to a network or a disk, where the transcript's runs on every chunk of a stream. The
 * two budgets are what differ — a slot the cache is going to hold until something evicts it is worth
 * one stringify to size, and a chunk arriving in a loop is not.
 */
function valueCharge(value: unknown): number {
    switch (typeof value) {
        case 'undefined':
            return 0
        case 'number':
        case 'boolean':
        case 'bigint':
            return 8
    }
    if (value === null) return 0
    // The exact answers first, because `JSON.stringify` is not one of them for a binary value: it
    // charges a 1 MB `ArrayBuffer` two bytes, which would make the biggest thing a cache can hold
    // the one thing the ceiling cannot see.
    const exact = exactCharge(value)
    if (exact !== -1) return exact
    try {
        return JSON.stringify(value)?.length ?? UNSIZED
    } catch {
        // A cycle, or a `toJSON` that threw. A value abide cannot size is still a value it is
        // holding on to, so it is charged the overhead rather than nothing.
        return UNSIZED
    }
}
