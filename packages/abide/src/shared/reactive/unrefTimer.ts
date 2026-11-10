/**
 * Keeps `timer` from holding the process open.
 *
 * 6.4's FEATURE TEST: Bun's `Timer` carries `unref`, a browser's number does not and has no process
 * to hold.
 */
export function unrefTimer(timer: unknown): void {
    const unref = (timer as { unref?: () => void }).unref
    if (typeof unref === 'function') unref.call(timer)
}
