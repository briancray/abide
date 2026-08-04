// WAIT FOR A CONDITION, NEVER FOR A DURATION.
//
// The suite runs `--parallel`, so a test's wall clock is shared with fifteen other files. A
// `await sleep(40)` standing in for "by now the stream has produced its third chunk" is a bet that the
// box is idle — it passes on a quiet machine and fails on a loaded one, which is the definition of a
// flake. Every such wait has an OBSERVABLE it was really waiting for; `until` waits for that instead,
// and a slow box just takes longer to pass.
//
// The timeout is deliberately far larger than any of the sleeps it replaces. It is not a tuned bound:
// it exists so a genuinely broken condition FAILS rather than hangs, and its message says what was
// being waited for. Raising it never makes a passing test fail.
//
// This is the one owner: `clientProxy.test.ts` had a private copy, and the polling interval and
// deadline handling are exactly the kind of thing two copies come to disagree about.

const DEFAULT_TIMEOUT_MS = 5_000
const POLL_MS = 2

export interface UntilOptions {
    timeoutMs?: number
    // What to call before each re-check. For a condition that needs a nudge rather than only time —
    // e.g. republishing onto a feed whose subscriber may not have attached yet, where the FIRST
    // publish can legitimately be missed and no amount of waiting will deliver it.
    poke?: () => void
}

export async function until(
    label: string,
    condition: () => boolean,
    options: UntilOptions = {},
): Promise<void> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const deadline = Date.now() + timeoutMs
    for (;;) {
        if (condition()) return
        if (Date.now() > deadline) {
            throw new Error(`until: ${label} — still false after ${timeoutMs}ms`)
        }
        options.poke?.()
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    }
}
