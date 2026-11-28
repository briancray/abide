// 18.11, 18.41, 18.43 — A SERVED VALUE'S CHAIN OF CHANGES: each a record of what it wrote over the
// version before, kept so a follower standing anywhere along it is sent the writes since rather than
// the value. One shape for both keepers of it: a value versioned in memory (`versionOf`), whose
// versions are the process's own counter, and one kept in its store's log (`DurableChain`), whose
// versions are the log's record numbers.

import type { PatchOp } from '#shared/reactive/patchLog.ts'

/**
 * One change: what it wrote, or the value whole — `replaced` where the writes are a production's diff
 * (18.41) rather than an `s.patch`'s.
 */
export type ChainRecord = {
    ops?: PatchOp[] | undefined
    snapshot?: unknown
    replaced?: true | undefined
}

/** A record, the version it stands at and the version it was written over. */
export type Kept = { seq: number; from: number; record: ChainRecord }

/** The writes past a version, and whether a production replaced the value among them (18.49). */
export type WritesSince = { ops: PatchOp[]; replaced: boolean }

// How many records back a follower can still be sent writes from (18.44); a chain lets go of what is
// behind twice this in bulk, so a write appends rather than shifting the chain.
export const WINDOW = 64

/**
 * Every write `records` holds past version `since`, in order, or `undefined` where none was written
 * over it — `since` older than the chain reaches, or not on it at all.
 */
export function writesFrom(
    records: readonly Kept[],
    since: number,
): WritesSince | undefined {
    let from = -1
    for (let at = records.length - 1; at >= 0; at -= 1)
        if ((records[at] as Kept).from === since) {
            from = at
            break
        }
    if (from === -1) return undefined
    const ops: PatchOp[] = []
    let replaced = false
    for (let at = from; at < records.length; at += 1) {
        const record = (records[at] as Kept).record
        if (record.snapshot !== undefined) {
            replaced = true
            ops.push({ op: 'replace', path: '', value: record.snapshot })
        } else {
            if (record.replaced === true) replaced = true
            for (const op of record.ops ?? []) ops.push(op)
        }
    }
    return { ops, replaced }
}

/**
 * The chain of a value versioned in memory: the last `WINDOW` to `2 * WINDOW` of its changes, none
 * of them a snapshot — a change that is the value whole breaks the chain instead (`versionOf`).
 */
export class MemoryChain {
    records: Kept[] = []

    /** `record`, written over `from`, standing at `seq`. */
    keep(from: number, seq: number, record: ChainRecord): void {
        const records = this.records
        records.push({ seq, from, record })
        if (records.length >= WINDOW * 2)
            records.splice(0, records.length - WINDOW)
    }

    since(since: number): WritesSince | undefined {
        return writesFrom(this.records, since)
    }
}
