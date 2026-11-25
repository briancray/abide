// 18.42-18.47 — A SERVED VALUE'S CHANGES, KEPT IN ITS STORE'S LOG. Where a memo's entry is kept in a
// store with an append face (`store.sqlite`, `store.redis`), its version is the number of a record of
// that log, and each change is a record: the JSON Patch it wrote, or a snapshot of the value. A
// restarted process opens the entry on the log, keeps its version where the value agrees, and sends a
// follower the records past the version it names; a process sharing the store hears another's records
// and applies them, so its followers are sent them too.
//
// A VERSION IS MINTED INSIDE A FRAME'S BUILD, so it is never waited for: this process names a change
// by the number after the last it knows, keeps the record in memory — which is what a follower is
// answered from — and writes it to the log behind, each append made only where that number is still
// free (18.46). Where another process took it first, its records are the log's, this process's
// unwritten changes are applied over them and written as one snapshot, and the numbers it had named
// are never answered with a patch again (18.47). A sync log (`store.sqlite`) runs the same path, its
// answers just arriving at once.

import { applyPatch } from '#shared/applyPatch.ts'
import type { Logged, LogStore } from '#shared/ledger.ts'
import { deepEqual } from '#shared/reactive/deepEqual.ts'
import { isThenable } from '#shared/reactive/isThenable.ts'
import { holdLog, type PatchOp } from '#shared/reactive/patchLog.ts'
import { produceInto } from '#shared/reactive/producer.ts'
import { type Reactive, unwatchStore } from '#shared/reactive/Reactive.ts'

/** One record of a served value's log: what a change wrote, or the value whole. */
type Record = { ops?: PatchOp[] | undefined; snapshot?: unknown }

/** A record and the number it stands at. */
type Kept = { seq: number; record: Record }

// How many records past the last snapshot before another is written, and how many are kept behind it
// for a follower a few changes back: the window a follower may stand anywhere in (18.44).
const WINDOW = 64

// 18.45 — how often a log is asked whether another process appended to it, and how long a log that failed is left before it is written to again.
const HEAR_EVERY = 1_000

/** `then` over a value that may be a promise, run at once where it is not. */
function settle<Value>(
    value: Value | Promise<Value>,
    then: (settled: Value) => void,
    failed: () => void,
): void {
    if (!isThenable(value)) {
        then(value as Value)
        return
    }
    ;(value as Promise<Value>).then(then, failed)
}

/** Every record of `log` past `from`, read page by page. */
function readFrom(
    log: LogStore,
    from: number,
    into: Kept[],
    then: (records: Kept[]) => void,
    failed: () => void,
): void {
    settle(
        log.since(from),
        (page: Logged<unknown>[]) => {
            if (page.length === 0) {
                then(into)
                return
            }
            for (const { seq, entry } of page)
                into.push({ seq, record: entry as Record })
            readFrom(
                log,
                (page[page.length - 1] as Logged<unknown>).seq,
                into,
                then,
                failed,
            )
        },
        failed,
    )
}

/** The log a value's store keeps, where it has an append face. */
function logOf(store: unknown): LogStore | undefined {
    const face = store as Partial<LogStore> | null | undefined
    return typeof face?.appendAt === 'function' &&
        typeof face.since === 'function' &&
        typeof face.last === 'function'
        ? (face as LogStore)
        : undefined
}

/** `ops` applied to `value`, answering what it becomes. */
function applied(value: unknown, record: Record): unknown {
    if (record.snapshot !== undefined) return structuredClone(record.snapshot)
    const holder = { value }
    applyPatch(holder, rooted(record.ops ?? []))
    return holder.value
}

export class DurableChain {
    log: LogStore
    value: Reactive<unknown>
    stamp: (chain: DurableChain, fresh: boolean) => void
    // Whether the log has been read, before which the value is versioned as any other (18.7).
    opened: boolean
    // The version this process stands at, a number it has named whether or not the log holds it yet.
    last: number
    // The last number the log is known to hold, and the value as it stood there.
    confirmed: number
    base: unknown
    // Records past the last snapshot, so a snapshot is written every `WINDOW`.
    sinceSnapshot: number
    // The records a follower is answered from, oldest first, the last `pending` of them not yet written.
    records: Kept[]
    pending: Kept[]
    // An append or a read in flight, after which the next is made, and whether the log was heard to
    // move meanwhile, so it is read once that is done.
    busy: boolean
    missed: boolean
    // 18.47 — numbers this process named that another process's records took.
    abandoned: Set<number>
    // A record another process appended, being applied: its number is the version it lands at.
    incoming: number | undefined

    constructor(
        log: LogStore,
        value: Reactive<unknown>,
        stamp: (chain: DurableChain, fresh: boolean) => void,
    ) {
        this.log = log
        this.value = value
        this.stamp = stamp
        this.opened = false
        this.last = 0
        this.confirmed = 0
        this.base = undefined
        this.sinceSnapshot = 0
        this.records = []
        this.pending = []
        this.busy = false
        this.missed = false
        this.abandoned = new Set()
        this.incoming = undefined
    }

    /** Names `record` by the number after the last, keeps it, and writes it behind (18.46). */
    append(record: Record, held: unknown): number {
        this.name(record)
        if (this.sinceSnapshot >= WINDOW)
            this.name({ snapshot: structuredClone(held) })
        this.write()
        return this.last
    }

    name(record: Record): void {
        this.last += 1
        const kept = { seq: this.last, record }
        this.keep(kept)
        this.pending.push(kept)
    }

    keep(kept: Kept): void {
        this.records.push(kept)
        this.sinceSnapshot =
            kept.record.snapshot !== undefined ? 0 : this.sinceSnapshot + 1
        // 18.44 — what the log keeps is what is kept here: at each snapshot, what is behind its window
        // is let go, cut once per window rather than per record.
        if (kept.record.snapshot === undefined) return
        let cut = 0
        while (
            cut < this.records.length &&
            (this.records[cut] as Kept).seq <= kept.seq - WINDOW * 2
        )
            cut += 1
        if (cut === 0) return
        this.records.splice(0, cut)
        for (const seq of this.abandoned)
            if (seq <= kept.seq - WINDOW * 2) this.abandoned.delete(seq)
    }

    /** The next unwritten record appended where its number is still free, in order. */
    write(): void {
        if (this.busy || !this.opened) return
        const next = this.pending[0]
        if (next === undefined) return
        this.busy = true
        settle(
            this.log.appendAt(next.record, this.confirmed, Date.now()),
            (landed) => {
                if (landed === undefined) {
                    this.reconcile()
                    return
                }
                this.pending.shift()
                this.confirm(next)
                if (next.record.snapshot !== undefined && next.seq > WINDOW * 2)
                    void this.log.trim(next.seq - WINDOW * 2)
                this.idle()
            },
            () => this.retry(),
        )
    }

    /** What waited on the append or read just done: the next record, or the log heard meanwhile. */
    idle(): void {
        this.busy = false
        if (this.pending.length > 0) this.write()
        else if (this.missed) this.hear()
    }

    confirm(kept: Kept): void {
        this.base = applied(this.base, kept.record)
        this.confirmed = kept.seq
    }

    retry(): void {
        this.busy = false
        setTimeout(() => this.write(), HEAR_EVERY).unref()
    }

    /**
     * 18.47 — ANOTHER PROCESS APPENDED FIRST: its records are applied to the value as the log left it,
     * this process's unwritten changes over them, and the result written as one snapshot at the number
     * after theirs, which is the version this process stands at from there.
     */
    reconcile(): void {
        readFrom(
            this.log,
            this.confirmed,
            [],
            (theirs) => {
                const ours = this.pending
                this.pending = []
                this.records.length -= ours.length
                for (const kept of ours) this.abandoned.add(kept.seq)
                for (const kept of theirs) {
                    this.keep(kept)
                    this.confirm(kept)
                }
                let merged = structuredClone(this.base)
                for (const { record } of ours)
                    try {
                        merged = applied(merged, record)
                    } catch {
                        // An op whose path their records took away is theirs to have decided.
                    }
                this.last = this.confirmed
                this.name({ snapshot: structuredClone(merged) })
                this.land(this.last, merged)
                this.idle()
            },
            () => this.retry(),
        )
    }

    /** `value` set as a production standing at `seq`, its followers sent the change (18.41). */
    land(seq: number, value: unknown): void {
        this.incoming = seq
        produceInto(this.value, structuredClone(value))
        this.stamp(this, false)
        this.incoming = undefined
    }

    /** 18.45 — another process's records, applied in order where this one has nothing unwritten. */
    hear(): void {
        if (this.busy || !this.opened || this.pending.length > 0) {
            this.missed = true
            return
        }
        this.missed = false
        this.busy = true
        readFrom(
            this.log,
            this.confirmed,
            [],
            (heard) => {
                // A change made here meanwhile is written first, and meets these as a conflict.
                if (this.pending.length === 0)
                    for (const kept of heard) {
                        this.keep(kept)
                        this.confirm(kept)
                        this.last = kept.seq
                        this.land(kept.seq, this.base)
                    }
                this.idle()
            },
            () => {
                this.busy = false
            },
        )
    }

    /** The patches past `since`, or `undefined` where the log no longer holds them (18.43, 18.47). */
    since(since: number): PatchOp[] | undefined {
        if (!this.opened || since > this.last || this.abandoned.has(since))
            return undefined
        if (since === this.last) return []
        const records = this.records
        let from = -1
        for (let at = records.length - 1; at >= 0; at -= 1)
            if ((records[at] as Kept).seq === since + 1) {
                from = at
                break
            }
        if (from === -1) return undefined
        const ops: PatchOp[] = []
        for (let at = from; at < records.length; at += 1) {
            const record = (records[at] as Kept).record
            if (record.snapshot !== undefined)
                ops.push({ op: 'replace', path: '', value: record.snapshot })
            else for (const op of record.ops ?? []) ops.push(op)
        }
        return ops
    }

    /**
     * 18.42 — OPENED ON WHAT THE LOG HOLDS: the last snapshot and the records after it are the value as
     * its last process left it. Where the value held agrees, the version stands at the log's last
     * record, so a follower reconnecting after a restart is sent only what it missed; where it does
     * not, the value held is written as a snapshot and is the version from there.
     */
    open(records: Kept[]): void {
        let rebuilt: unknown
        for (const kept of records) {
            if (kept.record.snapshot !== undefined || rebuilt !== undefined)
                rebuilt = applied(rebuilt, kept.record)
            this.keep(kept)
            this.confirmed = kept.seq
        }
        this.base = rebuilt
        this.last = this.confirmed
        this.opened = true
        const held = this.value.peek()
        if (rebuilt === undefined || !deepEqual(rebuilt, held)) {
            this.name({ snapshot: structuredClone(held) })
            this.write()
        }
    }
}

const CHAINS = new WeakMap<object, DurableChain | null>()

/**
 * The durable chain of the value `cell` serves, opened on its log the first time it is asked for, or
 * `null` where its store keeps no log. A log read asynchronously leaves the chain unopened until it
 * answers, its value versioned as any other until then and `stamp` told `fresh` once it is.
 */
export function chainOf(
    cell: object,
    value: Reactive<unknown>,
    store: unknown,
    stamp: (chain: DurableChain, fresh: boolean) => void,
): DurableChain | null {
    const known = CHAINS.get(cell)
    if (known !== undefined) return known
    const log = logOf(store)
    if (log === undefined) {
        CHAINS.set(cell, null)
        return null
    }
    const chain = new DurableChain(log, value, stamp)
    CHAINS.set(cell, chain)
    // 18.11 — a patch's writes are kept as data from here on, so each is a record of its own.
    holdLog(cell, () => undefined)
    let waited = false
    readFrom(
        log,
        0,
        [],
        (records) => {
            chain.open(records)
            if (waited) stamp(chain, true)
            // 18.45 — ANOTHER PROCESS'S RECORDS ARE HOW ITS CHANGES ARRIVE, so the value no longer
            // re-reads its store when told it moved (8.20): a re-read racing the log lands the value
            // as it stood before a record, and the change that undoes is a record of its own.
            unwatchStore(value)
            // Heard through the store's watch where it pushes one, and by asking the log what follows
            // once a `HEAR_EVERY` whether or not it does: a keyspace notification is sent once, to
            // whoever is subscribed, so one lost while subscribing or reconnecting is never resent.
            log.watch?.(() => chain.hear())
            // HELD WEAKLY: an entry let go (its `ttl`, an eviction) stops being asked, and the clock with it.
            const held = new WeakRef(chain)
            const clock = setInterval(() => {
                const alive = held.deref()
                if (alive === undefined) clearInterval(clock)
                else alive.hear()
            }, HEAR_EVERY)
            clock.unref()
            // 18.42 — EVERY CHANGE IS A RECORD from here on, followed or not, so a restart opens on all of it.
            value.watch(() => {
                stamp(chain, false)
            })
        },
        // A log that cannot be read is asked again on the next look.
        () => CHAINS.delete(cell),
    )
    waited = true
    return chain
}

/** `ops` re-rooted under `/value`, for `applyPatch` to reach a root `replace` through a holder. */
function rooted(ops: PatchOp[]): PatchOp[] {
    const under: PatchOp[] = []
    for (const op of ops)
        under.push({
            ...op,
            path: `/value${op.path}`,
            ...('from' in op ? { from: `/value${op.from}` } : {}),
        } as PatchOp)
    return under
}
