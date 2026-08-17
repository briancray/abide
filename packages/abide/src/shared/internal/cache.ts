// The ceiling on the memo cache that belongs to the PROCESS rather than to a caller.
//
// Its own module rather than a section of `ceilings.ts`, and the split is a bundling decision rather
// than a tidying one. `internal/graph.ts` imports the stream ceiling, and `graph.ts` is in every
// client entry's static closure — so a module reached from that closure keeps every export ANYTHING
// in the build uses, and the LRU below shipped to every page even though its only consumer, `memo.ts`,
// is not in the closure at all. Measured against the perf app, which had no demos in it: the
// class, the order, the three verbs and the stringifying charge are 888 bytes nothing on a first
// paint can reach. The same inversion `lines.ts` and `STREAMING.ts` already are.
//
// The edge runs one way — this file reads `ceilings.ts` for the charge the two budgets share, never
// the reverse — which is what keeps the stream half free of the cache half.
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

import { exactCharge, UNSIZED } from './ceilings.ts'
import { numberKnob } from './knobs.ts'
import { NO_LIMIT } from './timers.ts'

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
