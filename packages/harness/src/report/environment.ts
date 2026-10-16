// WHERE THIS RUNS, probed once and the same way by every lane.
//
// PROBED BY THE MEMBER the clock reads, so the answer is the capability the lanes rely on rather
// than the name of a global anything could define.

const UNDER_BUN =
    typeof (globalThis as { Bun?: { nanoseconds?: unknown } }).Bun
        ?.nanoseconds === 'function'

/** Whether this is bun, rather than a browser. */
export function underBun(): boolean {
    return UNDER_BUN
}

/**
 * `'dom'` where a DOM is present under bun, which makes it an emulator's, and `null` anywhere else.
 *
 * What a lane hands `batch` as `emulated` for an op that touches the DOM (43.22).
 */
export function emulatedDom(): 'dom' | null {
    return UNDER_BUN && typeof document !== 'undefined' ? 'dom' : null
}
