import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Component } from 'svelte'
import {
    bindPage,
    clientPageState,
    handleRenderError,
    renderState,
} from '../src/lib/browser/page.svelte.ts'
import { baseSlot } from '../src/lib/shared/baseSlot.ts'
import { settle } from './support/settle.ts'

/* Distinct component stand-ins so assertions can check identity, not just shape. */
const components = {
    boundaryPage: (() => {}) as unknown as Component,
    rootLayout: (() => {}) as unknown as Component,
    rootError: (() => {}) as unknown as Component,
}

const loader = (component: Component) => async () => ({ default: component })

const pages = { '/pages/boundary': loader(components.boundaryPage) }
const layouts = { '/': loader(components.rootLayout) }
const errors = { '/': loader(components.rootError) }

const ssr = { route: '/pages/boundary', params: {} }

type ErrorParams = { status: number; message: string; stack?: string }

/*
handleRenderError is App.svelte's svelte:boundary onerror — the client half of
the server renderPage catch. These tests drive it directly with a recorded
reset(), standing in for the boundary runtime: a covered throw swaps the
nearest error.svelte into renderState with { status, message, stack } params
and resets the boundary; an uncovered throw rethrows in place.
*/
describe('handleRenderError', () => {
    beforeEach(() => {
        /* applyState's syncUrl reads window.location.href after a view swap. */
        ;(globalThis as { window?: unknown }).window = {
            location: { href: 'https://test.local/pages/boundary?explode=1' },
        }
    })
    afterEach(() => {
        delete (globalThis as { window?: unknown }).window
    })

    test('a covered throw swaps in the nearest error.svelte with the server prop contract', async () => {
        await bindPage({ pages, layouts, errors, ssr })
        let resetCalls = 0

        handleRenderError(new Error('boom'), () => {
            resetCalls += 1
        })
        await settle()

        expect(renderState.Page).toBe(components.rootError)
        expect(renderState.Layout).toBe(components.rootLayout)
        expect(clientPageState.route).toBe('/pages/boundary')
        const params = clientPageState.params as unknown as ErrorParams
        expect(params.status).toBe(500)
        expect(params.message).toBe('boom')
        expect(typeof params.stack).toBe('string')
        expect(resetCalls).toBe(1)
    })

    test('under a mount base, the browser-space pathname still finds the boundary', async () => {
        /* page.url is browser-space (/v2/…); the prefix tables are app-space route paths. */
        baseSlot.fallback = '/v2'
        ;(globalThis as { window?: unknown }).window = {
            location: { href: 'https://test.local/v2/pages/boundary' },
        }
        try {
            await bindPage({ pages, layouts, errors, ssr })
            handleRenderError(new Error('boom'), () => {})
            await settle()

            expect(renderState.Page).toBe(components.rootError)
            /* Route keys stay app-space, matching the server's error render. */
            expect(clientPageState.route).toBe('/pages/boundary')
        } finally {
            baseSlot.fallback = undefined
        }
    })

    test('rethrows when no error.svelte covers the pathname, leaving render state alone', async () => {
        await bindPage({ pages, layouts, ssr })

        expect(() => handleRenderError(new Error('boom'), () => {})).toThrow('boom')
        await settle()

        expect(renderState.Page).toBe(components.boundaryPage)
        expect(clientPageState.params).toEqual({})
    })

    test('a throw while the error view is showing rethrows instead of looping', async () => {
        await bindPage({ pages, layouts, errors, ssr })

        handleRenderError(new Error('first'), () => {})
        await settle()

        expect(() => handleRenderError(new Error('second'), () => {})).toThrow('second')
    })

    test('a failed error-view render clears the guard instead of wedging later errors', async () => {
        /* The path is covered by an error prefix, but the error.svelte import throws. */
        const failingErrors = {
            '/': async () => {
                throw new Error('chunk load failed')
            },
        }
        await bindPage({ pages, layouts, errors: failingErrors, ssr })
        handleRenderError(new Error('first'), () => {})
        await settle()

        /* With the guard wedged true, a second covered error rethrows synchronously;
           cleared on failure, it re-attempts the (still failing) view instead. */
        expect(() => handleRenderError(new Error('second'), () => {})).not.toThrow()
        await settle()
    })

    test('a successful view swap re-arms the boundary', async () => {
        await bindPage({ pages, layouts, errors, ssr })
        handleRenderError(new Error('first'), () => {})
        await settle()

        /* Any applied view (bindPage and navigate share applyState) clears the guard. */
        await bindPage({ pages, layouts, errors, ssr })
        let resetCalls = 0
        handleRenderError(new Error('second'), () => {
            resetCalls += 1
        })
        await settle()

        expect(resetCalls).toBe(1)
        expect(renderState.Page).toBe(components.rootError)
    })
})
