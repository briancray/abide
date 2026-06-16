import { describe, expect, test } from 'bun:test'
import { createReachable } from '../src/lib/server/runtime/createReachable.ts'

/* A scripted probe whose outcome is flippable, counting how often it actually ran. */
function scriptedProbe(up = true) {
    const state = { up, calls: 0 }
    const probe = async (_origin: string) => {
        state.calls += 1
        return state.up
    }
    return { state, probe }
}

const ms = (n: number) => Bun.sleep(n)

describe('reachable (createReachable)', () => {
    test('the first read awaits a real probe — an up host reads true', async () => {
        const { probe } = scriptedProbe(true)
        const { reachable, stop } = createReachable({ probe, intervalMs: 100_000, idleMs: 100_000 })
        expect(await reachable('https://a.test')).toBe(true)
        stop()
    })

    test('the first read is faithful — a down host reads false, not the optimistic seed', async () => {
        const { probe } = scriptedProbe(false)
        const { reachable, stop } = createReachable({ probe, intervalMs: 100_000, idleMs: 100_000 })
        expect(await reachable('https://a.test')).toBe(false)
        stop()
    })

    test('concurrent cold reads share one inaugural probe', async () => {
        const { state, probe } = scriptedProbe(true)
        const { reachable, stop } = createReachable({ probe, intervalMs: 100_000, idleMs: 100_000 })
        const [a, b] = await Promise.all([reachable('https://a.test'), reachable('https://a.test')])
        expect([a, b]).toEqual([true, true])
        expect(state.calls).toBe(1)
        stop()
    })

    test('keys by origin — a different path on the same host is a warm read, not a new probe', async () => {
        const { state, probe } = scriptedProbe(true)
        const { reachable, stop } = createReachable({ probe, intervalMs: 100_000, idleMs: 100_000 })
        await reachable('https://a.test/orders')
        await reachable('https://a.test/users')
        expect(state.calls).toBe(1)
        stop()
    })

    test('a bare host defaults to https and shares the origin with the explicit form', async () => {
        const { state, probe } = scriptedProbe(true)
        const { reachable, stop } = createReachable({ probe, intervalMs: 100_000, idleMs: 100_000 })
        expect(await reachable('a.test')).toBe(true)
        await reachable('https://a.test') // same origin ⇒ warm, no second probe
        expect(state.calls).toBe(1)
        stop()
    })

    test('tracks origins independently', async () => {
        const probe = async (origin: string) => origin.includes('up')
        const { reachable, stop } = createReachable({ probe, intervalMs: 100_000, idleMs: 100_000 })
        expect(await reachable('https://up.test')).toBe(true)
        expect(await reachable('https://down.test')).toBe(false)
        stop()
    })

    test('the background poll flips a host to unreachable after it goes down', async () => {
        const { state, probe } = scriptedProbe(true)
        const { reachable, stop } = createReachable({ probe, intervalMs: 15, idleMs: 100_000 })
        expect(await reachable('https://a.test')).toBe(true)
        state.up = false
        /* failureLimit (2) consecutive misses ⇒ a few intervals to flip. */
        await ms(70)
        expect(await reachable('https://a.test')).toBe(false)
        stop()
    })

    test('recovers when the host comes back', async () => {
        const { state, probe } = scriptedProbe(false)
        const { reachable, stop } = createReachable({ probe, intervalMs: 15, idleMs: 100_000 })
        expect(await reachable('https://a.test')).toBe(false)
        state.up = true
        /* The first poll success always reports — one interval. */
        await ms(45)
        expect(await reachable('https://a.test')).toBe(true)
        stop()
    })

    test('reaps a host nobody has read within the idle window — its poll stops', async () => {
        const { state, probe } = scriptedProbe(true)
        const { reachable, stop } = createReachable({ probe, intervalMs: 15, idleMs: 30 })
        await reachable('https://a.test')
        await ms(90) // idle past idleMs ⇒ reaped, polling stops
        const callsAfterReap = state.calls
        await ms(90) // quiet — a live poll would keep incrementing
        expect(state.calls).toBe(callsAfterReap)
        stop()
    })
})
