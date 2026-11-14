// 38.179 — the native window's main thread sleeps in AppKit's wait (`appKitLoop`), and what has to reach it
// does so without a timer: a message from the launcher's thread, by a Mach message to the wake port,
// and a signal, by libdispatch's main queue. Each is run in a child with no Dock icon and no window.

import { expect, test } from 'bun:test'

import { spawned } from '@abide/harness/gate'

const SLEEPER = `${import.meta.dir}/fixtures/appKitLoop/sleeper.ts`
const ON_MAC = process.platform === 'darwin'
// A second to settle, a second idle, and the late wake three after: longer than a test's default.
const TIMEOUT_MILLISECONDS = 15000

async function slept(mode: 'message' | 'signal'): Promise<unknown> {
    const ran = await spawned(['bun', SLEEPER, mode], { deadline: 15000 })
    expect(ran.stderr).not.toContain('error')
    return JSON.parse(ran.stdout.trim())
}

// THE REVERTS: `wakeWindow` sending nothing leaves the message undelivered, and the child runs out
// its deadline; the old drain — `nextEventMatchingMask` with `distantPast` every 8 ms — makes
// 1,127-1,160 Mach calls over the idle second, where the sleeping thread makes 13-29.
test.skipIf(!ON_MAC)(
    "a message reaches the main thread asleep in AppKit's wait, which makes next to no calls idle",
    async () => {
        const { idleCalls } = (await slept('message')) as { idleCalls: number }
        expect(idleCalls).toBeLessThan(200)
    },
    TIMEOUT_MILLISECONDS,
)

// THE REVERT: `onSignal` as a `process.on` handler runs only once the late wake ends the wait —
// `beforeLateWake` false, 3,003 ms after the signal.
test.skipIf(!ON_MAC)(
    "a signal reaches the main thread inside AppKit's wait",
    async () => {
        expect(await slept('signal')).toEqual({ beforeLateWake: true })
    },
    TIMEOUT_MILLISECONDS,
)
