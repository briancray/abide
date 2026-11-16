// 38.204 — `settled` from `@abide/abide/test`: what a test awaits after it clicks, in place of a
// `Bun.sleep` long enough on the machine it was written on. The loads it waits on are the ones the
// core keeps once this entry has loaded (`keepLoads`, 38.206).

import { pendingWork } from '#shared/reactive/producer.ts'
import { flushSync } from '#shared/reactive/Reactive.ts'

const DEFAULT_TIMEOUT_MILLISECONDS = 2_000

/**
 * Resolves once no value is loading and no effect is pending, running every effect that wakes on
 * the way; throws naming what is still pending where `timeout` passes first.
 */
export async function settled(options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MILLISECONDS
    const deadline = performance.now() + timeout
    for (;;) {
        flushSync()
        // A task, not a microtask: an in-process call answers over turns of the event loop, and a
        // click's handler may start its load only after one.
        await new Promise((resolve) => setTimeout(resolve, 1))
        flushSync()
        const pending = pendingWork()
        if (pending.loading.length === 0 && pending.effects === 0) return
        if (performance.now() < deadline) continue
        const named: string[] = []
        if (pending.loading.length > 0)
            named.push(
                `${pending.loading.length} still loading (${pending.loading.join(', ')})`,
            )
        if (pending.effects > 0)
            named.push(`${pending.effects} effects pending`)
        throw new Error(
            `abide: settled() waited ${timeout} ms and ${named.join(' and ')}. RULEBOOK 38.205.`,
        )
    }
}
