import { describe, expect, test } from 'bun:test'
import { createReachable } from '../src/lib/shared/createReachable.ts'
import { reachable } from '../src/lib/shared/reachable.ts'

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
        const { reachable, stop } = createReachable({ probe, ttlMs: 100_000 })
        expect(await reachable('https://a.test')).toBe(true)
        stop()
    })

    test('the first read is faithful — a down host reads false, not the optimistic seed', async () => {
        const { probe } = scriptedProbe(false)
        const { reachable, stop } = createReachable({ probe, ttlMs: 100_000 })
        expect(await reachable('https://a.test')).toBe(false)
        stop()
    })

    test('a read within the TTL is warm — no second probe', async () => {
        const { state, probe } = scriptedProbe(true)
        const { reachable, stop } = createReachable({ probe, ttlMs: 100_000 })
        expect(await reachable('https://a.test')).toBe(true)
        expect(await reachable('https://a.test')).toBe(true)
        expect(state.calls).toBe(1)
        stop()
    })

    test('concurrent cold reads share one probe', async () => {
        const { state, probe } = scriptedProbe(true)
        const { reachable, stop } = createReachable({ probe, ttlMs: 100_000 })
        const [a, b] = await Promise.all([reachable('https://a.test'), reachable('https://a.test')])
        expect([a, b]).toEqual([true, true])
        expect(state.calls).toBe(1)
        stop()
    })

    test('keys by origin — a different path on the same host is a warm read, not a new probe', async () => {
        const { state, probe } = scriptedProbe(true)
        const { reachable, stop } = createReachable({ probe, ttlMs: 100_000 })
        await reachable('https://a.test/orders')
        await reachable('https://a.test/users')
        expect(state.calls).toBe(1)
        stop()
    })

    test('a bare host defaults to https and shares the origin with the explicit form', async () => {
        const { state, probe } = scriptedProbe(true)
        const { reachable, stop } = createReachable({ probe, ttlMs: 100_000 })
        expect(await reachable('a.test')).toBe(true)
        await reachable('https://a.test') // same origin ⇒ warm, no second probe
        expect(state.calls).toBe(1)
        stop()
    })

    test('tracks origins independently', async () => {
        const probe = async (origin: string) => origin.includes('up')
        const { reachable, stop } = createReachable({ probe, ttlMs: 100_000 })
        expect(await reachable('https://up.test')).toBe(true)
        expect(await reachable('https://down.test')).toBe(false)
        stop()
    })

    test('a read past the TTL re-probes and flips a host that went down', async () => {
        const { state, probe } = scriptedProbe(true)
        const { reachable, stop } = createReachable({ probe, ttlMs: 20 })
        expect(await reachable('https://a.test')).toBe(true)
        state.up = false
        await ms(35) // past the TTL ⇒ the next read re-probes
        expect(await reachable('https://a.test')).toBe(false)
        expect(state.calls).toBe(2)
        stop()
    })

    test('recovers on the next read after the TTL when the host comes back', async () => {
        const { state, probe } = scriptedProbe(false)
        const { reachable, stop } = createReachable({ probe, ttlMs: 20 })
        expect(await reachable('https://a.test')).toBe(false)
        state.up = true
        await ms(35)
        expect(await reachable('https://a.test')).toBe(true)
        stop()
    })
})

describe('reachable() — the app-backend form', () => {
    test('no host is constant true on the server — the server is its own backend', async () => {
        expect(await reachable()).toBe(true)
    })

    test('no host short-circuits true on a loopback origin, no probe spent', async () => {
        /* Nothing listens on this origin, so a probe would answer false — true proves
           the loopback short-circuit, not a lucky fetch. */
        const globals = globalThis as { window?: unknown; location?: unknown }
        globals.window = {}
        globals.location = new URL('http://localhost:59999/')
        try {
            expect(await reachable()).toBe(true)
        } finally {
            delete globals.window
            delete globals.location
        }
    })
})
