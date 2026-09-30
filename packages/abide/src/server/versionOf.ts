// 18.22 — THE VERSION A VALUE'S STANDING PRODUCTION IS NAMED BY OVER THE WIRE. Stamped where it is
// asked for rather than where a production is minted, so a value no browser follows pays nothing on
// its production path. A production is told apart from the one before by the ordinal (18.10), what
// is held (6.18 moves no ordinal for `undefined`) and the patch epoch of what is held (5.7 moves no
// ordinal for a patch).
//
// ONE COUNTER FOR THE PROCESS, started at the boot time in microseconds, so no two productions share
// a number: not two values, not an entry evicted and built again, and not this process and the one
// before it, which would have had to mint over a thousand a millisecond for its whole life to reach
// where this one starts.
//
// 18.26 — A VERSION ONLY PATCHES MOVED TO keeps what they wrote, and the version they were written
// over, so a follower standing there is sent the writes rather than the value.

import { pastOf } from '#shared/reactive/index.ts'
import { PATCH_SINKS, type PatchOp } from '#shared/reactive/PATCH_SINKS.ts'
import { PATCHES } from '#shared/reactive/PATCHES.ts'

let next = Date.now() * 1000

type Stamp = {
    ordinal: number
    held: unknown
    patched: number
    version: number
    from: number | undefined
    ops: PatchOp[] | null
}

const STAMPS = new WeakMap<object, Stamp>()

/** The version a value's standing production is named by over the wire. 18.22. */
export function versionOf(value: unknown): number {
    const cell = pastOf(value)
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
    STAMPS.set(cell, {
        ordinal: cell.ordinal,
        held,
        patched,
        version: next,
        from: stamp?.version,
        ops,
    })
    return next
}

/**
 * The patches written over version `from`, or `undefined` where a follower must be sent the value.
 *
 * What the patches written over `from` wrote, where they are all that moved the value since — and
 * `undefined` where a follower standing anywhere has to be sent the value.
 */
export function patchesOf(
    value: unknown,
): { from: number | undefined; ops: PatchOp[] } | undefined {
    const stamp = STAMPS.get(pastOf(value))
    return stamp === undefined || stamp.ops === null
        ? undefined
        : { from: stamp.from, ops: stamp.ops }
}
