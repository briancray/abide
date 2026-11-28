// 18.7 — THE VERSION A VALUE'S STANDING PRODUCTION IS NAMED BY OVER THE WIRE. Stamped where it is
// asked for rather than where a production is minted, so a value no browser follows pays nothing on
// its production path. A production is told apart from the one before by the ordinal, what is held
// and the patch epoch of what is held (5.7 moves no ordinal for a patch).
//
// ONE COUNTER FOR THE PROCESS, started at the boot time in microseconds, so no two productions share
// a number: not two values, not an entry evicted and built again, and not this process and the one
// before it, which would have had to mint over a thousand a millisecond for its whole life to reach
// where this one starts.
//
// 18.11 — A VERSION ONLY PATCHES MOVED TO keeps what they wrote, and the versions they were written
// over, back through the last `WINDOW` of them (`patchChain`), so a follower standing anywhere on that chain
// is sent the writes since rather than the value — a reconnect a few lines behind a log, or a burst a
// slow tab missed. A production that replaced the value is a step too, as the diff from the value it
// replaced (18.41); only one whose diff is the value whole breaks the chain.

import { diffOps } from '#shared/reactive/diffOps.ts'
import { elementKeyOf } from '#shared/reactive/elementKeyOf.ts'
import { drainLog, type PatchOp } from '#shared/reactive/patchLog.ts'
import { writtenAt } from '#shared/reactive/patchMarks.ts'
import { servedCellOf } from '#shared/reactive/producer.ts'
import type { Reactive } from '#shared/reactive/Reactive.ts'

import { chainOf, type DurableChain } from './durableChain.ts'
import { MemoryChain, type WritesSince } from './patchChain.ts'

let next = Date.now() * 1000

type Stamp = {
    ordinal: number
    held: unknown
    patched: number
    version: number
    // The changes that led to this version — none where a change that is the value whole broke them.
    recent: MemoryChain
}

const STAMPS = new WeakMap<object, Stamp>()

/**
 * 18.42 — the log a value's store keeps, once it has been read: until then (a log read asynchronously,
 * 18.46) the value is versioned as any other, and stamped again from the log once it answers.
 */
function durableOf(cell: object, value: unknown): DurableChain | null {
    const chain = chainOf(
        cell,
        value as Reactive<unknown>,
        (cell as { store?: { store?: unknown } | null | undefined }).store
            ?.store,
        (opened, fresh) => {
            if (fresh) STAMPS.delete(cell)
            versionOf(opened.value)
        },
    )
    return chain?.opened === true ? chain : null
}

/** The version a value's standing production is named by over the wire. 18.7. */
export function versionOf(value: unknown): number {
    const cell = servedCellOf(value)
    // 18.42 — where the value's store keeps a log, its versions are that log's record numbers.
    const chain = durableOf(cell, value)
    const held = (value as { peek(): unknown }).peek()
    const patched = writtenAt(held)
    const stamp = STAMPS.get(cell)
    if (
        stamp !== undefined &&
        stamp.ordinal === cell.ordinal &&
        stamp.held === held &&
        stamp.patched === patched
    )
        return stamp.version
    // THE WRITES SINCE THE LAST STAMP stand for the change where nothing else moved it; a value
    // replaced is diffed against the one it replaced (18.41), so the chain carries on through it —
    // unless the diff is one `replace` of the root, which is the value whole and which no follower can
    // apply in place to a value of another shape (a primitive, `undefined`, an array become a record).
    const drained = drainLog(cell)
    let ops: PatchOp[] | null = null
    let replaced = false
    if (stamp !== undefined)
        if (stamp.ordinal === cell.ordinal && stamp.held === held) ops = drained
        else {
            replaced = true
            const diffed = diffOps(stamp.held, held, elementKeyOf(value))
            ops = diffed.length === 1 && diffed[0]?.path === '' ? null : diffed
        }
    let version: number
    if (chain === null) {
        next += 1
        version = next
    } else if (chain.incoming !== undefined) version = chain.incoming
    // A chain just opened stands at the log's last record, which is the value held (18.42).
    else if (stamp === undefined) version = chain.last
    else
        version = chain.append(
            ops === null
                ? { snapshot: structuredClone(held) }
                : replaced
                  ? { ops, replaced: true }
                  : { ops },
            held,
        )
    // The chain carries on from the stamp this replaces, which it takes over.
    const recent =
        ops === null || stamp === undefined ? new MemoryChain() : stamp.recent
    if (ops !== null && stamp !== undefined)
        recent.keep(
            stamp.version,
            version,
            replaced ? { ops, replaced: true } : { ops },
        )
    STAMPS.set(cell, {
        ordinal: cell.ordinal,
        held,
        patched,
        version,
        recent,
    })
    return version
}

/**
 * Every write made since version `since`, in order, or `undefined` where its follower must be sent
 * the value: `since` older than the chain reaches, or not on it at all.
 */
export function patchesSince(
    value: unknown,
    since: number | undefined,
): WritesSince | undefined {
    if (since === undefined) return undefined
    const cell = servedCellOf(value)
    // 18.43 — a value kept in a log is sent what the log holds past `since`, across restarts.
    const chain = durableOf(cell, value)
    if (chain !== null) return chain.since(since)
    return STAMPS.get(cell)?.recent.since(since)
}
