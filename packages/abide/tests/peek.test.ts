import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { amend } from '../src/lib/shared/amend.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { createRemoteFunction } from '../src/lib/shared/createRemoteFunction.ts'
import { hydrationWindow } from '../src/lib/shared/hydrationWindow.ts'
import { peek } from '../src/lib/shared/peek.ts'
import { refresh } from '../src/lib/shared/refresh.ts'
import { state } from '../src/lib/ui/state.ts'
import { settle } from './support/settle.ts'

const BROWSER_ONLY = { browser: true, mcp: false, cli: false }

function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json' },
    })
}

describe('peek()', () => {
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
        hydrationWindow.active = false
    })

    test('undefined before any read, the value after a settled read, no invoke', async () => {
        const globals = globalThis as Record<string, unknown>
        const realWindow = globals.window
        globals.window = { location: { href: 'http://x/' } }
        try {
            let invokes = 0
            const getThing = createRemoteFunction<undefined, { id: string }>({
                method: 'GET',
                url: '/rpc/peekThing',
                clients: BROWSER_ONLY,
                buildRequest: () => new Request('http://x/rpc/peekThing'),
                invoke: async () => {
                    invokes += 1
                    return jsonResponse({ id: '1' })
                },
            })
            /* Nothing retained yet — non-triggering, so still no invoke. */
            expect(peek(getThing)).toBeUndefined()
            expect(invokes).toBe(0)

            expect(await getThing()).toEqual({ id: '1' })
            await settle()
            /* Retained value now readable synchronously; peek fired no extra invoke. */
            expect(peek(getThing)).toEqual({ id: '1' })
            expect(invokes).toBe(1)
        } finally {
            globals.window = realWindow
        }
    })

    test('reflects an amend without a network round-trip', async () => {
        const globals = globalThis as Record<string, unknown>
        const realWindow = globals.window
        globals.window = { location: { href: 'http://x/' } }
        try {
            const getList = createRemoteFunction<undefined, string[]>({
                method: 'GET',
                url: '/rpc/peekList',
                clients: BROWSER_ONLY,
                buildRequest: () => new Request('http://x/rpc/peekList'),
                invoke: async () => jsonResponse(['a']),
            })
            await getList()
            await settle()
            expect(peek(getList)).toEqual(['a'])

            amend(getList, (list) => [...list, 'b'])
            await settle()
            expect(peek(getList)).toEqual(['a', 'b'])
        } finally {
            globals.window = realWindow
        }
    })

    /* The kitchen-sink probes-demo shape: a computed over peek(fn, args). The retained
       value lands via materializeRetained's async decode, which signals markLifecycle
       only — no invalidate event — so peek must tap the key's lifecycle channel or the
       scope reads undefined once and never re-runs ("nothing retained yet" forever). */
    test('a tracking scope over peek re-runs when the retained value lands, and again after refresh', async () => {
        const globals = globalThis as Record<string, unknown>
        const realWindow = globals.window
        globals.window = { location: { href: 'http://x/' } }
        try {
            let serial = 0
            const getRates = createRemoteFunction<{ base: string }, { rates: { EUR: number } }>({
                method: 'GET',
                url: '/rpc/peekRates',
                clients: BROWSER_ONLY,
                buildRequest: () => new Request('http://x/rpc/peekRates?base=USD'),
                invoke: async () => {
                    serial += 1
                    return jsonResponse({ rates: { EUR: serial } })
                },
            })
            const snapshot = state.computed(() => peek(getRates, { base: 'USD' }))
            /* Evaluated before anything retained — the scope's dependency is registered here. */
            expect(snapshot.value).toBeUndefined()

            await getRates({ base: 'USD' })
            await settle()
            expect(snapshot.value).toEqual({ rates: { EUR: 1 } })

            /* The demo's "spam me" button: invalidate → background refetch → fresh value. */
            refresh(getRates, { base: 'USD' })
            await settle()
            expect(snapshot.value).toEqual({ rates: { EUR: 2 } })
        } finally {
            globals.window = realWindow
        }
    })

    /* Candidate A: during the hydration pass peek withholds the warm value (the server
       rendered the fallback — its entry.value is never materialized server-side), so the
       client's first paint stays congruent with the SSR text. hydrationWindow.wake re-runs the
       scope once the pass ends, swapping in the now-congruent retained value. */
    test('withholds the warm value while hydrating, then wakes the scope when the pass ends', async () => {
        const globals = globalThis as Record<string, unknown>
        const realWindow = globals.window
        globals.window = { location: { href: 'http://x/' } }
        try {
            const getThing = createRemoteFunction<undefined, { id: string }>({
                method: 'GET',
                url: '/rpc/peekHydrate',
                clients: BROWSER_ONLY,
                buildRequest: () => new Request('http://x/rpc/peekHydrate'),
                invoke: async () => jsonResponse({ id: '1' }),
            })
            await getThing()
            await settle()
            /* Warm value is retained and readable outside a hydration pass. */
            expect(peek(getThing)).toEqual({ id: '1' })

            /* Enter the hydration pass: peek is withheld (server-congruent undefined), so a
               tracking scope reads undefined and the SSR text is preserved. */
            hydrationWindow.active = true
            const snapshot = state.computed(() => peek(getThing))
            expect(snapshot.value).toBeUndefined()
            expect(peek(getThing)).toBeUndefined()

            /* Pass ends: wake re-runs the scope on the now-congruent retained value (the
               lifecycle mark defers one microtask, so drain it before asserting). */
            hydrationWindow.active = false
            hydrationWindow.wake()
            await settle()
            expect(snapshot.value).toEqual({ id: '1' })
        } finally {
            globals.window = realWindow
        }
    })
})
