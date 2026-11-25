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
// over, back through the last `RECENT_PATCHES` of them, so a follower standing anywhere on that chain
// is sent the writes since rather than the value — a reconnect a few lines behind a log, or a burst a
// slow tab missed. A production that replaced the value is a step too, as the diff from the value it
// replaced (18.41); only one whose diff would say more than the value breaks the chain.

import { diffOps } from '#shared/reactive/diffOps.ts'
import { elementKeyOf } from '#shared/reactive/elementKeyOf.ts'
import { drainLog, type PatchOp } from '#shared/reactive/patchLog.ts'
import { writtenAt } from '#shared/reactive/patchMarks.ts'
import { servedCellOf } from '#shared/reactive/producer.ts'
import type { Reactive } from '#shared/reactive/Reactive.ts'

import { chainOf } from './durableChain.ts'

let next = Date.now() * 1000

// How many patch steps back a follower can still be sent writes from. Trimmed in bulk at twice this,
// so a write appends rather than shifting the chain.
const RECENT_PATCHES = 64

/** One patch's step along the chain: the version it was written over, and what it wrote. */
type Step = { from: number; ops: PatchOp[] }

type Stamp = {
    ordinal: number
    held: unknown
    patched: number
    version: number
    // The patch steps that led to this version, oldest first — empty where a production broke them.
    recent: Step[]
}

const STAMPS = new WeakMap<object, Stamp>()

/** The version a value's standing production is named by over the wire. 18.7. */
export function versionOf(value: unknown): number {
    const cell = servedCellOf(value)
    // 18.42 — where the value's store keeps a log, its versions are that log's record numbers.
    const chain = chainOf(
        cell,
        value as Reactive<unknown>,
        (cell as { store?: { store?: unknown } | null | undefined }).store
            ?.store,
        (opened) => {
            versionOf(opened.value)
        },
    )
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
    // replaced is diffed against the one it replaced (18.41), so the chain carries on through it.
    const drained = drainLog(cell)
    const ops =
        stamp === undefined
            ? null
            : stamp.ordinal === cell.ordinal && stamp.held === held
              ? drained
              : stamp.held === undefined || held === undefined
                ? null
                : diffOps(stamp.held, held, elementKeyOf(value))
    let version: number
    if (chain === null) {
        next += 1
        version = next
    } else if (chain.incoming !== undefined) version = chain.incoming
    // A chain just opened stands at the log's last record, which is the value held (18.42).
    else if (stamp === undefined) version = chain.last
    else
        version = chain.append(
            ops === null ? { snapshot: structuredClone(held) } : { ops },
            held,
        )
    // The chain carries on from the stamp this replaces, whose array it takes over.
    const recent = ops === null || stamp === undefined ? [] : stamp.recent
    if (ops !== null && stamp !== undefined) {
        recent.push({ from: stamp.version, ops })
        if (recent.length >= RECENT_PATCHES * 2)
            recent.splice(0, recent.length - RECENT_PATCHES)
    }
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
 * Every patch written since version `since`, in order, or `undefined` where its follower must be sent
 * the value: `since` older than the chain reaches, or not on it at all.
 */
export function patchesSince(
    value: unknown,
    since: number | undefined,
): PatchOp[] | undefined {
    if (since === undefined) return undefined
    const cell = servedCellOf(value)
    // 18.43 — a value kept in a log is sent what the log holds past `since`, across restarts.
    const chain = chainOf(
        cell,
        value as Reactive<unknown>,
        (cell as { store?: { store?: unknown } | null | undefined }).store
            ?.store,
        (opened) => {
            versionOf(opened.value)
        },
    )
    if (chain !== null) return chain.since(since)
    const recent = STAMPS.get(cell)?.recent
    if (recent === undefined) return undefined
    for (let at = 0; at < recent.length; at += 1) {
        if ((recent[at] as Step).from !== since) continue
        if (at === recent.length - 1) return (recent[at] as Step).ops
        const ops: PatchOp[] = []
        for (let step = at; step < recent.length; step += 1)
            for (const op of (recent[step] as Step).ops) ops.push(op)
        return ops
    }
    return undefined
}
