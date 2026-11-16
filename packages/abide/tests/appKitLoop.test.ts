// 38.179 — the native window's main thread sleeps in AppKit's wait (`appKitLoop`), and what has to reach it
// does so without a timer: a message from the launcher's thread, by a Mach message to the wake port,
// and a signal, by libdispatch's main queue. Each is run in a child with no Dock icon and no window.

import { expect, test } from 'bun:test'

import { spawned } from '@abide/harness/gate'

const SLEEPER = `${import.meta.dir}/fixtures/appKitLoop/sleeper.ts`
const SOURCE = `${import.meta.dir}/../src/`
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

// What waits on bun's own loop — a timer, the network, the disk, a child, a signal handler — waits on
// the main thread until something else wakes it, which in an idle window is never. `setImmediate`
// is not among them: the thread yields to bun after every turn of AppKit's wait.
const WAITS_ON_BUN =
    /\b(?:setTimeout|setInterval|fetch)\(|\bBun\.(?:file|write|spawn|spawnSync|sleep|serve|\$)\b|process\.on\(\s*'SIG|from 'node:/

// THE WINDOW'S MODULES ARE FOUND BY WHAT THEY IMPORT, from the two the main thread starts in, so a
// module added under them is read without anyone listing it. A type import loads nothing.
// `windowBridge` and `pageBridge` are exempt by what they ARE: each function is handed to the page
// as source, and runs in WebKit rather than here.
// THE REVERT: `blockOnce` freeing its block in a `setTimeout`, as it did, is named here.
test("nothing on the native window's main thread waits on bun's own loop", async () => {
    const PAGE_SIDE = new Set([
        'server/windowBridge.ts',
        'server/pageBridge.ts',
    ])
    const read = new Map<string, string>()
    const pending = ['server/openNativeWindow.ts', 'server/appKitLoop.ts']
    while (pending.length > 0) {
        const path = pending.pop() as string
        if (read.has(path)) continue
        const text = await Bun.file(`${SOURCE}${path}`).text()
        read.set(path, text)
        for (const [, type, specifier] of text.matchAll(
            /^import (type )?[^;]*?from '((?:\.\/|#server\/|#shared\/)[^']+)'/gm,
        )) {
            if (type !== undefined || specifier === undefined) continue
            pending.push(
                specifier.startsWith('#')
                    ? specifier.slice(1)
                    : `server/${specifier.slice(2)}`,
            )
        }
    }
    for (const bridge of ['windowBridge', 'pageBridge'])
        expect(read.get('server/openNativeWindow.ts')).toContain(
            `${bridge}.toString()`,
        )
    const waiting: string[] = []
    for (const [path, text] of read) {
        if (PAGE_SIDE.has(path)) continue
        const lines = text.split('\n')
        for (let at = 0; at < lines.length; at += 1)
            if (WAITS_ON_BUN.test(lines[at] as string))
                waiting.push(`${path}:${at + 1}`)
    }
    expect(read.size).toBeGreaterThan(5)
    expect(waiting).toEqual([])
})
