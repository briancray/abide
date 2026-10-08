// WHERE THIS RUNS, probed once and the same way by every lane.
//
// PROBED BY THE MEMBER, NOT BY THE GLOBAL. A docs example frame defines a `Bun.serve` shim so a
// hand-written arm's `server.ts` can run in the page, so `globalThis.Bun` is truthy in a browser
// that has no `nanoseconds` — and a bare check called headless chromium bun.

const UNDER_BUN =
    typeof (globalThis as { Bun?: { nanoseconds?: unknown } }).Bun
        ?.nanoseconds === 'function'

/** Whether this is bun, rather than a browser — one with a `Bun.serve` shim included. */
export function underBun(): boolean {
    return UNDER_BUN
}

/**
 * `'dom'` where a DOM is present under bun, which makes it an emulator's, and `null` anywhere else.
 *
 * What a lane hands `batch` as `emulated` for an op that touches the DOM (44.23).
 */
export function emulatedDom(): 'dom' | null {
    return UNDER_BUN && typeof document !== 'undefined' ? 'dom' : null
}
