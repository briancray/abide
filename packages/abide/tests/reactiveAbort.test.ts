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

/* The remoteProxy fetch path via `.raw`: the bound signal reaches fetch, and our
   cancellation is swallowed into a never-settling promise rather than surfacing as a
   rejection. Transport concerns (the abort signal here) live on `.raw` — the bare
   smart call is coalesced/cache-managed and deliberately drops per-reader transport
   so one reader leaving can't abort a shared flight. */
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
            void getThing.raw({ id: 1 }).then(
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

/* RpcOptions: the curated per-call transport bag (signal/keepalive/priority/cache/
   headers) lives on `.raw` now — it reaches the Request and the fetch init, framework
   headers win on conflict, the caller signal merges with the scope signal, and cache
   management gates it. (The bare smart call's second arg is cache options, not transport.) */
describe('remoteProxy RpcOptions', () => {
    const globals = globalThis as Record<string, unknown>
    let restore: (() => void) | undefined
    let captured: { request?: Request; init?: RequestInit }

    /* A stub fetch that records the Request + init and resolves with a decodable
       JSON body, so the plain call's decode path doesn't reject. */
    function stubFetch(): void {
        const originalFetch = globals.fetch
        const originalWindow = globals.window
        globals.window = { location: { href: 'http://localhost/' } }
        captured = {}
        globals.fetch = (input: unknown, init?: RequestInit): Promise<Response> => {
            captured.request = input as Request
            captured.init = init
            return Promise.resolve(
                new Response('null', { headers: { 'content-type': 'application/json' } }),
            )
        }
        restore = () => {
            globals.fetch = originalFetch
            globals.window = originalWindow
        }
    }

    afterEach(() => {
        restore?.()
        restore = undefined
    })

    test('merges caller headers onto the request; framework owns content-type', async () => {
        stubFetch()
        const postThing = remoteProxy<{ x: number }, unknown>('POST', '/rpc/thing')
        await postThing.raw(
            { x: 1 },
            { headers: { 'x-idempotency-key': 'abc', 'content-type': 'text/plain' } },
        )
        expect(captured.request?.headers.get('x-idempotency-key')).toBe('abc')
        /* buildRpcRequest sets content-type last, so the framework's JSON wins. */
        expect(captured.request?.headers.get('content-type')).toBe('application/json')
    })

    test('passes keepalive/priority/cache through to fetch', async () => {
        stubFetch()
        const postThing = remoteProxy<{ x: number }, unknown>('POST', '/rpc/thing')
        await postThing.raw({ x: 1 }, { keepalive: true, priority: 'low', cache: 'no-store' })
        expect(captured.init?.keepalive).toBe(true)
        expect(captured.init?.priority).toBe('low')
        expect(captured.init?.cache).toBe('no-store')
    })

    test('a caller signal aborts the fetch outside any reactive scope', () => {
        stubFetch()
        const controller = new AbortController()
        const postThing = remoteProxy<{ x: number }, unknown>('POST', '/rpc/thing')
        void postThing.raw({ x: 1 }, { signal: controller.signal })
        expect(captured.init?.signal?.aborted).toBe(false)
        controller.abort()
        expect(captured.init?.signal?.aborted).toBe(true)
    })

    test('merges the caller signal with the scope signal (either aborts the fetch)', () => {
        stubFetch()
        const controller = new AbortController()
        const postThing = remoteProxy<{ x: number }, unknown>('POST', '/rpc/thing')
        const stop = effect(() => {
            void postThing.raw({ x: 1 }, { signal: controller.signal })
        })
        const merged = captured.init?.signal
        expect(merged?.aborted).toBe(false)
        controller.abort() // the caller source alone aborts the merged signal
        expect(merged?.aborted).toBe(true)
        stop()
    })

    test('ignores the caller signal under cache management so a coalesced flight survives', async () => {
        stubFetch()
        const controller = new AbortController()
        const postThing = remoteProxy<{ x: number }, unknown>('POST', '/rpc/thing')
        await withCacheManaged(() => postThing({ x: 1 }, { signal: controller.signal }))
        /* No scope + caller signal gated → no signal reaches fetch (unbounded). */
        expect(captured.init?.signal).toBeUndefined()
    })
})
