// 18.11 — WHAT A PATCH WROTE, KEPT AS DATA for a value the server follows over the mux, by the cell
// it was written to. Only a followed value has a log, so every other patch records nothing but its
// marks (32.33). And 7.10 — what an invalidate of that value sends on: the core calls the log's
// followers for every cell it invalidates, however the trigger was spelled, so every other
// invalidate is one miss.
//
// HELD WHILE ANYONE IS FED THE VALUE, and gone with the last: a log nobody drains grows with every
// patch.

/**
 * One JSON Patch operation (RFC 6902), its `path` and `from` JSON Pointers (RFC 6901).
 *
 * A patch abide records is `add`, `remove` and `replace` alone; `move`, `copy` and `test` are
 * applied where a client sends them.
 */
export type PatchOp =
    | { op: 'add'; path: string; value: unknown }
    | { op: 'remove'; path: string }
    | { op: 'replace'; path: string; value: unknown }
    | { op: 'move'; from: string; path: string }
    | { op: 'copy'; from: string; path: string }
    | { op: 'test'; path: string; value: unknown }

/**
 * The writes patches made, as `recordWrites` keeps them. `lost` where one could not be kept as data,
 * and then the change is sent as the value (18.13). `followers` is `null` on a log one patch keeps
 * for itself rather than one the server holds.
 */
export class PatchLog {
    ops: PatchOp[] = []
    lost = false
    readonly followers: Set<() => void> | null

    constructor(followers: Set<() => void> | null) {
        this.followers = followers
    }
}

const LOGS = new WeakMap<object, PatchLog>()

/** The log held on `cell`, or `undefined` where nothing follows it. */
export function logOf(cell: object): PatchLog | undefined {
    return LOGS.get(cell)
}

/**
 * Holds a log on `cell`, with `invalidated` called on its every invalidate; returns what releases
 * both.
 */
export function holdLog(cell: object, invalidated: () => void): () => void {
    let log = LOGS.get(cell)
    if (log === undefined) {
        log = new PatchLog(new Set())
        LOGS.set(cell, log)
    }
    const followers = log.followers as Set<() => void>
    followers.add(invalidated)
    return () => {
        followers.delete(invalidated)
        if (followers.size === 0) LOGS.delete(cell)
    }
}

/**
 * The writes kept on `cell` since the last drain, or `null` where there are none or one was lost —
 * and the log starts over either way.
 */
export function drainLog(cell: object): PatchOp[] | null {
    const log = LOGS.get(cell)
    if (log === undefined) return null
    const ops = log.lost || log.ops.length === 0 ? null : log.ops
    log.ops = []
    log.lost = false
    return ops
}

/** Calls every follower of `cell`'s log: an invalidate reached it. 7.6. */
export function sendInvalidate(cell: object): void {
    const followers = LOGS.get(cell)?.followers
    if (followers !== undefined && followers !== null)
        for (const sendOn of followers) sendOn()
}
