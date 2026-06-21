import { afterEach, describe, expect, test } from 'bun:test'
import { cacheManagedSlot } from '../src/lib/shared/cacheManagedSlot.ts'
import { withCacheManaged } from '../src/lib/shared/withCacheManaged.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { remoteProxy } from '../src/lib/ui/remoteProxy.ts'
import { currentAbortSignal } from '../src/lib/ui/runtime/currentAbortSignal.ts'
import { REQUEST_SUPERSEDED } from '../src/lib/ui/runtime/REQUEST_SUPERSEDED.ts'
import { scope } from '../src/lib/ui/runtime/scope.ts'
import { state } from '../src/lib/ui/state.ts'

/* currentAbortSignal models what an RPC fetch reads inside a reactive read: the
   AbortSignal bound to the running computation. These tests drive the binding
   directly (no network), then one exercises the remoteProxy fetch path end to end. */
describe('scope-bound RPC abort', () => {
    test('binds one signal per reactive computation and reuses it within a run', () => {
        const seen: AbortSignal[] = []
        const stop = effect(() => {
            const a = currentAbortSignal()
            const b = currentAbortSignal()
            if (a !== undefined) {
                seen.push(a)
            }
            expect(a).toBe(b) // same controller for repeated calls in one run
        })
        expect(seen).toHaveLength(1)
        expect(seen[0]?.aborted).toBe(false)
        stop()
    })

    test('aborts the prior run when the computation re-runs (superseded)', () => {
        const dep = state(0)
        const signals: AbortSignal[] = []
        const stop = effect(() => {
            dep.value // subscribe so a write re-runs this effect
            const signal = currentAbortSignal()
            if (signal !== undefined) {
                signals.push(signal)
            }
        })
        expect(signals).toHaveLength(1)
        expect(signals[0]?.aborted).toBe(false)

        dep.value = 1 // supersede the first run
        expect(signals).toHaveLength(2)
        expect(signals[0]?.aborted).toBe(true)
        expect(signals[0]?.reason).toBe(REQUEST_SUPERSEDED)
        expect(signals[1]?.aborted).toBe(false) // the fresh run's signal is live

        stop()
    })

    test('aborts on dispose when the owning scope tears down (navigated away)', () => {
        const captured: AbortSignal[] = []
        const disposeScope = scope(() => {
            effect(() => {
                const signal = currentAbortSignal()
                if (signal !== undefined) {
                    captured.push(signal)
                }
            })
        })
        expect(captured[0]?.aborted).toBe(false)

        disposeScope()
        expect(captured[0]?.aborted).toBe(true)
        expect(captured[0]?.reason).toBe(REQUEST_SUPERSEDED)
    })

    test('returns undefined outside any reactive computation', () => {
        expect(currentAbortSignal()).toBeUndefined()
    })

    test('returns undefined for cache-managed calls so coalescing survives one reader leaving', () => {
        let bound: AbortSignal | undefined
        let suppressed: AbortSignal | undefined = {} as AbortSignal
        const stop = effect(() => {
            bound = currentAbortSignal() // a bare call binds to this effect
            suppressed = withCacheManaged(() => currentAbortSignal()) // a cache-managed one does not
        })
        expect(bound).toBeDefined()
        expect(suppressed).toBeUndefined()
        expect(cacheManagedSlot.active).toBe(false) // flag restored after the call
        stop()
    })
})

/* The remoteProxy fetch path: the bound signal reaches fetch, and our cancellation
   is swallowed into a never-settling promise rather than surfacing as a rejection. */
describe('remoteProxy scope abort', () => {
    const globals = globalThis as Record<string, unknown>
    let restore: (() => void) | undefined

    afterEach(() => {
        restore?.()
        restore = undefined
    })

    test('a superseded reactive RPC aborts on the wire and never settles', async () => {
        const originalFetch = globals.fetch
        const originalWindow = globals.window
        /* remoteProxy builds its Request against window.location; a stub fetch honours
           the signal the way a real one does — reject with signal.reason on abort. */
        globals.window = { location: { href: 'http://localhost/' } }
        const signals: (AbortSignal | undefined)[] = []
        globals.fetch = (_input: unknown, init?: { signal?: AbortSignal }): Promise<Response> => {
            signals.push(init?.signal)
            return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
            })
        }
        restore = () => {
            globals.fetch = originalFetch
            globals.window = originalWindow
        }

        const getThing = remoteProxy<{ id: number }, unknown>('GET', '/rpc/thing')
        const dep = state(0)
        let settled = false
        const stop = effect(() => {
            dep.value
            void getThing({ id: 1 }).then(
                () => {
                    settled = true
                },
                () => {
                    settled = true
                },
            )
        })

        expect(signals).toHaveLength(1)
        expect(signals[0]?.aborted).toBe(false)
        const first = signals[0]

        dep.value = 1 // supersede → the first request's signal aborts
        expect(first?.aborted).toBe(true)
        expect(first?.reason).toBe(REQUEST_SUPERSEDED)
        expect(signals).toHaveLength(2) // the re-run fired a fresh request

        await Bun.sleep(0)
        expect(settled).toBe(false) // aborted call swallowed, neither resolves nor rejects

        stop()
    })
})
