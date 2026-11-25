// 18.42-18.45 — A SERVED VALUE'S CHANGES, KEPT IN ITS STORE'S LOG. Where a memo's entry is kept in a
// store with an append face (`store.sqlite`), its version is the number of the last record of that
// log, and each change is a record: the JSON Patch it wrote, or a snapshot of the value. A restarted
// process opens the entry on the log, keeps its version where the value agrees, and sends a follower
// the records past the version it names; a process sharing the store hears another's records through
// the log's watch and applies them, so its followers are sent them too.
//
// THE LOG IS READ SYNCHRONOUSLY, as a version is minted inside a frame's build. A store whose append
// face answers a promise keeps the in-process chain `versionOf` keeps for every other value.

import { applyPatch } from '#shared/applyPatch.ts'
import type { LogStore } from '#shared/ledger.ts'
import { deepEqual } from '#shared/reactive/deepEqual.ts'
import { holdLog, type PatchOp } from '#shared/reactive/patchLog.ts'
import { produceInto } from '#shared/reactive/producer.ts'
import type { Reactive } from '#shared/reactive/Reactive.ts'

/** One record of a served value's log: what a change wrote, or the value whole. */
type Record = { ops?: PatchOp[] | undefined; snapshot?: unknown }

// How many records past the last snapshot before another is written, and how many are kept behind it
// for a follower a few changes back: the window a follower may stand anywhere in (18.44).
const WINDOW = 64

// 18.45 — how often a log with no watch of its own is asked whether another process appended to it.
const HEAR_EVERY = 1_000

/** The log a value's store keeps, where it has a synchronous append face. */
function logOf(store: unknown): LogStore | undefined {
    const face = store as Partial<LogStore> | null | undefined
    if (
        typeof face?.append !== 'function' ||
        typeof face.since !== 'function' ||
        typeof face.last !== 'function'
    )
        return undefined
    return typeof face.last() === 'number' ? (face as LogStore) : undefined
}

export class DurableChain {
    log: LogStore
    value: Reactive<unknown>
    // The number of the last record this process has read or written.
    last: number
    // Records past the last snapshot, so a snapshot is written every `WINDOW`.
    sinceSnapshot: number
    // The numbers of the records this process appended, which its own watch hears too.
    mine: Set<number>
    // A record another process appended, being applied: its number is the version it lands at.
    incoming: number | undefined

    constructor(log: LogStore, value: Reactive<unknown>) {
        this.log = log
        this.value = value
        this.last = 0
        this.sinceSnapshot = 0
        this.mine = new Set()
        this.incoming = undefined
    }

    /** Appends `record`, returning its number, a snapshot following once the window has filled. */
    append(record: Record, held: unknown): number {
        const seq = this.log.append(record, undefined, Date.now()) as number
        this.mine.add(seq)
        this.last = seq
        this.sinceSnapshot =
            record.snapshot !== undefined ? 0 : this.sinceSnapshot + 1
        if (this.sinceSnapshot >= WINDOW) {
            const snapshot = this.log.append(
                { snapshot: structuredClone(held) },
                undefined,
                Date.now(),
            ) as number
            this.mine.add(snapshot)
            this.last = snapshot
            this.sinceSnapshot = 0
            // 18.44 — the window behind the snapshot is kept, and what is past it let go.
            if (snapshot > WINDOW * 2) void this.log.trim(snapshot - WINDOW * 2)
            return snapshot
        }
        return seq
    }

    /** The patches past `since`, or `undefined` where the log no longer holds them (18.43). */
    since(since: number): PatchOp[] | undefined {
        const records = this.log.since(since) as {
            seq: number
            entry: unknown
        }[]
        if (records.length === 0) return since === this.last ? [] : undefined
        if ((records[0] as { seq: number }).seq !== since + 1) return undefined
        const ops: PatchOp[] = []
        for (const { entry } of records) {
            const record = entry as Record
            if (record.snapshot !== undefined)
                ops.push({ op: 'replace', path: '', value: record.snapshot })
            else for (const op of record.ops ?? []) ops.push(op)
        }
        return ops
    }
}

const CHAINS = new WeakMap<object, DurableChain | null>()

/**
 * The durable chain of the value `cell` serves, opened on its log the first time it is asked for, or
 * `null` where its store keeps no synchronous log.
 *
 * 18.42 — OPENED ON WHAT THE LOG HOLDS: the last snapshot and the records after it are the value as
 * its last process left it. Where the value held agrees, the version stands at the log's last record,
 * so a follower reconnecting after a restart is sent only what it missed; where it does not, the value
 * held is written as a snapshot and is the version from there.
 */
export function chainOf(
    cell: object,
    value: Reactive<unknown>,
    store: unknown,
    stamp: (chain: DurableChain) => void,
): DurableChain | null {
    const known = CHAINS.get(cell)
    if (known !== undefined) return known
    const log = logOf(store)
    if (log === undefined) {
        CHAINS.set(cell, null)
        return null
    }
    const chain = new DurableChain(log, value)
    CHAINS.set(cell, chain)
    // 18.11 — a patch's writes are kept as data from here on, so each is a record of its own.
    holdLog(cell, () => undefined)
    const records = log.since(0) as { seq: number; entry: unknown }[]
    let rebuilt: unknown
    let since = 0
    for (const { seq, entry } of records) {
        const record = entry as Record
        if (record.snapshot !== undefined) {
            rebuilt = structuredClone(record.snapshot)
            since = 0
        } else if (rebuilt !== undefined) {
            const holder = { value: rebuilt }
            applyPatch(holder, rooted(record.ops ?? []))
            rebuilt = holder.value
            since += 1
        }
        chain.last = seq
    }
    chain.sinceSnapshot = since
    const held = value.peek()
    if (rebuilt === undefined || !deepEqual(rebuilt, held))
        chain.append({ snapshot: structuredClone(held) }, held)
    // 18.45 — ANOTHER PROCESS'S RECORDS, heard and applied here, its followers sent them as its own:
    // through the store's watch where it pushes one, and otherwise by asking the log for its last
    // number once a `HEAR_EVERY`, which is one indexed read.
    const hear = (): void => {
        if ((log.last() as number) <= chain.last) return
        const heard = log.since(chain.last) as {
            seq: number
            entry: unknown
        }[]
        for (const { seq, entry } of heard) {
            if (chain.mine.delete(seq)) {
                chain.last = seq
                continue
            }
            const record = entry as Record
            chain.incoming = seq
            // Landed as a production, whose diff this process's followers are sent (18.41).
            const holder = {
                value:
                    record.snapshot !== undefined
                        ? record.snapshot
                        : structuredClone(value.peek()),
            }
            if (record.snapshot === undefined)
                applyPatch(holder, rooted(record.ops ?? []))
            produceInto(value, structuredClone(holder.value))
            stamp(chain)
            chain.incoming = undefined
            chain.last = seq
        }
    }
    if (log.watch !== undefined) log.watch(hear)
    else {
        // HELD WEAKLY: an entry let go (its `ttl`, an eviction) stops being asked for, and the clock with it.
        const held = new WeakRef(chain)
        const clock = setInterval(() => {
            if (held.deref() === undefined) clearInterval(clock)
            else hear()
        }, HEAR_EVERY)
        clock.unref()
    }
    // 18.42 — EVERY CHANGE IS A RECORD from here on, followed or not, so a restart opens on all of it.
    value.watch(() => {
        stamp(chain)
    })
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
