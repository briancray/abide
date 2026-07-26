// A server render is a component's whole life: the effects its `<script>` sets up belong to the REQUEST,
// and the request disposes them when its work is finished. Without that, every render leaves its
// `watch`es subscribed to whatever they read that outlives the request (a `<script module>` cell, a
// `$shared/*` state), so one later write re-runs one dead effect per request ever served — and the
// teardown those effects returned never runs at all.
//
// The owner scope must also be PER REQUEST, not per process: a `<script>` may `await`, and two renders
// that interleave across that await would otherwise hand their effects to each other.

import { describe, expect, test } from 'bun:test'
import {
    createReactiveScope,
    disposeScope,
    enterScope,
} from '../../shared/internal/reactiveScope.ts'
import { state } from '../../shared/state.ts'
import { watch } from '../../shared/watch.ts'
import { loadEmittedServer } from './emit.ts'

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// `<script module>` runs once per module, so its cell outlives every render — the lifetime mismatch
// that makes a per-render subscription a leak.
const PAGE =
    `<script module>` +
    `import { state } from "abide/shared/state"; ` +
    `let ticks = state(0); ` +
    `globalThis.$bump = () => { ticks = ticks + 1 }` +
    `</script>` +
    `<script>` +
    `import { watch } from "abide/shared/watch"; ` +
    `watch(() => { globalThis.$runs = (globalThis.$runs ?? 0) + 1; ticks; return () => { globalThis.$cleanups = (globalThis.$cleanups ?? 0) + 1 } })` +
    `</script>` +
    `<p>hi</p>`

// The same page, but its setup AWAITS before declaring the watch — the interleaving window.
const AWAITING_PAGE =
    `<script module>` +
    `import { state } from "abide/shared/state"; ` +
    `let ticks = state(0); ` +
    `globalThis.$bump = () => { ticks = ticks + 1 }` +
    `</script>` +
    `<script>` +
    `import { watch } from "abide/shared/watch"; ` +
    `import { gate } from "$shared/gate"; ` +
    `await gate(); ` +
    `watch(() => { globalThis.$runs = (globalThis.$runs ?? 0) + 1; ticks; return () => { globalThis.$cleanups = (globalThis.$cleanups ?? 0) + 1 } })` +
    `</script>` +
    `<p>hi</p>`

interface Probe {
    $runs: number
    $cleanups: number
    $bump: () => void
}
const probe = globalThis as unknown as Probe

// One render inside its own context, disposed the way `runInScope` disposes a finished request.
async function renderRequest(module: { render(scope?: Record<string, unknown>): Promise<string> }) {
    const context = createReactiveScope()
    await enterScope(context, () => module.render({ state, watch }))
    disposeScope(context)
}

describe('server render effect ownership', () => {
    test('a finished request unsubscribes its render effects and runs their teardowns', async () => {
        const module = await loadEmittedServer(PAGE, undefined, () => undefined)
        probe.$runs = 0
        probe.$cleanups = 0

        await renderRequest(module)
        await renderRequest(module)
        await renderRequest(module)
        expect(probe.$runs).toBe(3) // one run per render
        expect(probe.$cleanups).toBe(3) // each render's teardown ran when its request finished

        // The dead renders are detached: a later write re-runs none of them.
        probe.$bump()
        await tick()
        expect(probe.$runs).toBe(3)
    })

    test('an awaiting setup does not hand its effects to a request that overtakes it', async () => {
        const module = await loadEmittedServer(AWAITING_PAGE, undefined, () => undefined)
        probe.$runs = 0
        probe.$cleanups = 0

        // Both requests park INSIDE their setup preamble, so both scopes are open at once; then A
        // resumes and finishes first. On a process-global stack, A's close would truncate B off it, and
        // B's watch — created when it finally resumes — would be created with no owner at all: leaked,
        // teardown never run. Per context, B still has its own scope open.
        let releaseA = (): void => {}
        let releaseB = (): void => {}
        const gateA = new Promise<void>((resolve) => {
            releaseA = () => resolve()
        })
        const gateB = new Promise<void>((resolve) => {
            releaseB = () => resolve()
        })
        const contextA = createReactiveScope()
        const contextB = createReactiveScope()
        const renderA = enterScope(contextA, () =>
            module.render({ state, watch, gate: () => gateA }),
        )
        const renderB = enterScope(contextB, () =>
            module.render({ state, watch, gate: () => gateB }),
        )
        expect(probe.$runs).toBe(0) // both parked mid-setup, both scopes open

        releaseA()
        await renderA
        expect(probe.$runs).toBe(1)

        releaseB()
        await renderB
        expect(probe.$runs).toBe(2)
        expect(probe.$cleanups).toBe(0) // neither request is finished yet

        disposeScope(contextA)
        expect(probe.$cleanups).toBe(1) // exactly A's effect
        disposeScope(contextB)
        expect(probe.$cleanups).toBe(2) // B's own effect, not stranded by A's close

        probe.$bump()
        await tick()
        expect(probe.$runs).toBe(2)
    })
})
