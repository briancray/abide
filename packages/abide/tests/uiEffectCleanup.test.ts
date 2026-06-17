import { describe, expect, test } from 'bun:test'
import { effect } from '../src/lib/ui/effect.ts'
import { state } from '../src/lib/ui/state.ts'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('effect cleanup', () => {
    test('a returned teardown runs on dispose, stopping a timer started in the body', () => {
        let ticks = 0
        const dispose = effect(() => {
            const id = setInterval(() => {
                ticks += 1
            }, 1)
            return () => clearInterval(id)
        })
        const before = ticks
        dispose()
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                /* Cleared on dispose → no further ticks after teardown ran. */
                expect(ticks).toBe(before)
                resolve()
            }, 10)
        })
    })

    test('teardown runs before each re-run, so a re-running effect never leaks a timer', () => {
        const trigger = state(0)
        let live = 0
        let maxLive = 0
        const dispose = effect(() => {
            trigger.value // dependency: re-runs on change
            live += 1
            maxLive = Math.max(maxLive, live)
            return () => {
                live -= 1
            }
        })
        expect(live).toBe(1)
        trigger.value = 1 // re-run: prior teardown runs first
        trigger.value = 2
        expect(live).toBe(1) // never two live at once
        expect(maxLive).toBe(1)
        dispose()
        expect(live).toBe(0) // final teardown ran
    })

    test('an async body runs its async teardown without the flush awaiting it', async () => {
        let cleaned = false
        const dispose = effect(async () => {
            await Promise.resolve()
            return async () => {
                await Promise.resolve()
                cleaned = true
            }
        })
        await tick() // let the async setup settle so the teardown is available
        dispose()
        expect(cleaned).toBe(false) // teardown is chained, not awaited by dispose
        await tick()
        expect(cleaned).toBe(true) // ran once its promise settled
    })

    test('disposing mid-setup still tears down once the async setup settles', async () => {
        let cleaned = false
        const dispose = effect(async () => {
            await tick()
            return () => {
                cleaned = true
            }
        })
        dispose() // setup promise not yet resolved
        await tick()
        await tick()
        expect(cleaned).toBe(true) // teardown chained off the unresolved setup
    })
})
