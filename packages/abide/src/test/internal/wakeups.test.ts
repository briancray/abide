// The wake-up counter's own contract. Everything asserted through it depends on two things being
// right: the subscription's ESTABLISHING run is not a wake-up, and `settled` is the baseline.

import { describe, expect, test } from 'bun:test'
import { state } from '../../shared/internal/reactive.ts'
import { settled, stopAll, tick, wakeups } from './wakeups.ts'

describe('wakeups', () => {
    test('the establishing run is not counted', async () => {
        const cell = state(0)
        const probe = wakeups(() => cell())
        await settled(probe)
        expect(probe.count).toBe(0)
        probe.stop()
    })

    test('counts one re-run per settled change', async () => {
        const cell = state(0)
        const probe = wakeups(() => cell())
        await settled(probe)

        cell.set(1)
        await tick()
        expect(probe.count).toBe(1)

        cell.set(2)
        await tick()
        expect(probe.count).toBe(2)
        probe.stop()
    })

    test('a write of the value already held wakes nobody — the property everything else rests on', () => {
        const cell = state(0)
        const probe = wakeups(() => cell())
        return settled(probe).then(async () => {
            cell.set(0)
            await tick()
            expect(probe.count).toBe(0)
            probe.stop()
        })
    })

    test('`settled` re-baselines, so counts are relative to the last one', async () => {
        const cell = state(0)
        const probe = wakeups(() => cell())
        await settled(probe)

        cell.set(1)
        await settled(probe)
        expect(probe.count).toBe(0)

        cell.set(2)
        await tick()
        expect(probe.count).toBe(1)
        probe.stop()
    })

    test('a stopped probe stops counting', async () => {
        const cell = state(0)
        const probe = wakeups(() => cell())
        await settled(probe)
        probe.stop()

        cell.set(1)
        await tick()
        expect(probe.count).toBe(0)
    })

    test('probes on DIFFERENT cells count independently', async () => {
        const a = state(0)
        const b = state(0)
        const onA = wakeups(() => a())
        const onB = wakeups(() => b())
        await settled(onA, onB)

        a.set(1)
        await tick()
        expect(onA.count).toBe(1)
        expect(onB.count).toBe(0)
        stopAll(onA, onB)
    })
})
