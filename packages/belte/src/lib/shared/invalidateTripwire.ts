import { belteLog } from './belteLog.ts'

/*
Same-selector invalidations within one macrotask before the warning fires. A
reactive loop spins on microtasks (lifecycle mark → effect flush →
invalidate), starving macrotasks — so the reset timer below never runs while
one is live, and legitimate repeats (socket frames, user events) arriving
across macrotasks clear the count instead.
*/
const LOOP_THRESHOLD = 25

const invalidationCounts = new Map<string, number>()
let resetTimer: ReturnType<typeof setTimeout> | undefined

/*
Cycle tripwire for cache.invalidate. Svelte's effect_update_depth_exceeded
counts synchronous re-runs, but the probes' lifecycle marks defer a microtask
(createLifecycleChannel), so a self-feeding effect — one that reads a probe or
cached value and invalidates a selector that re-wakes its own scope — spins
forever without tripping it, pinning the CPU. Many invalidations of one
selector inside a single macrotask is that signature. Warns once per episode
(the starved reset timer can't fire mid-loop, so the count only crosses the
threshold once); reporting only — invalidation proceeds.
*/
export function invalidateTripwire(selectorLabel: string): void {
    const count = (invalidationCounts.get(selectorLabel) ?? 0) + 1
    invalidationCounts.set(selectorLabel, count)
    if (resetTimer === undefined) {
        resetTimer = setTimeout(() => {
            resetTimer = undefined
            invalidationCounts.clear()
        }, 0)
        resetTimer.unref?.()
    }
    if (count === LOOP_THRESHOLD) {
        belteLog.warn(
            `cache.invalidate(${selectorLabel}) fired ${LOOP_THRESHOLD}× within one task — likely a reactive loop: an $effect that reads pending()/refreshing() or a cached value and invalidates a selector waking its own scope re-triggers itself across microtasks, invisible to Svelte's loop detection. Find the $effect invalidating ${selectorLabel}.`,
        )
    }
}
