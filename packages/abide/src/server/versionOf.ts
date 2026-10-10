// 18.7 — THE VERSION A VALUE'S STANDING PRODUCTION IS NAMED BY OVER THE WIRE. Stamped where it is
// asked for rather than where a production is minted, so a value no browser follows pays nothing on
// its production path. A production is told apart from the one before by the ordinal, what is held
// (6.10 moves no ordinal for `undefined`) and the patch epoch of what is held (5.7 moves no ordinal
// for a patch).
//
// ONE COUNTER FOR THE PROCESS, started at the boot time in microseconds, so no two productions share
// a number: not two values, not an entry evicted and built again, and not this process and the one
// before it, which would have had to mint over a thousand a millisecond for its whole life to reach
// where this one starts.
//
// 18.11 — A VERSION ONLY PATCHES MOVED TO keeps what they wrote, and the versions they were written
// over, back through the last `RECENT_PATCHES` of them, so a follower standing anywhere on that chain
// is sent the writes since rather than the value — a reconnect a few lines behind a log, or a burst a
// slow tab missed. A production that was not a patch breaks the chain.

import { servedCellOf } from '#shared/reactive/index.ts'
import { PATCH_SINKS, type PatchOp } from '#shared/reactive/PATCH_SINKS.ts'
import { PATCHES } from '#shared/reactive/PATCHES.ts'

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
    const held = (value as { peek(): unknown }).peek()
    const patched =
        held !== null && typeof held === 'object'
            ? (PATCHES.written.get(held) ?? 0)
            : 0
    const stamp = STAMPS.get(cell)
    if (
        stamp !== undefined &&
        stamp.ordinal === cell.ordinal &&
        stamp.held === held &&
        stamp.patched === patched
    )
        return stamp.version
    // THE WRITES SINCE THE LAST STAMP stand for the change only where nothing else moved it.
    const sink = PATCH_SINKS.get(cell)
    const onlyPatched =
        stamp !== undefined &&
        stamp.ordinal === cell.ordinal &&
        stamp.held === held
    const ops =
        onlyPatched && sink !== undefined && !sink.lost && sink.ops.length > 0
            ? sink.ops
            : null
    if (sink !== undefined) {
        sink.ops = []
        sink.lost = false
    }
    next += 1
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
        version: next,
        recent,
    })
    return next
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
    const recent = STAMPS.get(servedCellOf(value))?.recent
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
