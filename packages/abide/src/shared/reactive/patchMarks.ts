// 32.33 — WHICH OBJECTS AN `s.patch` WROTE TO, AND WHEN. The epoch moves once per patch and each
// object written holds the epoch it was last written at, so a row that took its item at epoch `e` is
// stale exactly where its item was written since `e`. No imports, because `reconcile` and the
// socket wire read it on the client and must not drag the core into the runtime chunk with it.

let epoch = 0
const WRITTEN = new WeakMap<object, number>()

/** The epoch the last patch wrote at, 0 before any. */
export function patchEpoch(): number {
    return epoch
}

/** Opens a patch: moves the epoch, and returns the one its writes are marked at. */
export function openPatch(): number {
    epoch += 1
    return epoch
}

/** Marks `written` as written by the patch at `at`. */
export function markWritten(written: object, at: number): void {
    WRITTEN.set(written, at)
}

/** The epoch a patch last wrote to `value` at, 0 where none has or it is not an object. */
export function writtenAt(value: unknown): number {
    if (value === null || typeof value !== 'object') return 0
    return WRITTEN.get(value) ?? 0
}

/** Whether a patch wrote to `value` after epoch `since`. */
export function writtenSince(value: unknown, since: number): boolean {
    return writtenAt(value) > since
}
