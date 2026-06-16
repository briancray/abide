import { afterEach, describe, expect, test } from 'bun:test'
import { activePage } from '../src/lib/shared/activePage.ts'
import { pageSlot } from '../src/lib/shared/pageSlot.ts'
import type { PageSnapshot } from '../src/lib/shared/types/PageSnapshot.ts'

/*
The `page` proxy resolves route/params/url through activePage's registered
resolver rather than a module singleton. These tests stand in for the two
runtimes: swapping the resolver between reads is exactly what the server's ALS
does per request, proving concurrent/streaming renders never share page state.
*/
describe('activePage resolver', () => {
    afterEach(() => {
        pageSlot.resolver = undefined
        pageSlot.fallback = undefined
    })

    test('reflects the registered resolver snapshot', () => {
        const snapshot: PageSnapshot = {
            route: '/posts/[id]',
            params: { id: '42' },
            url: new URL('https://test.local/posts/42'),
            navigating: false,
        }
        pageSlot.resolver = () => snapshot

        expect(activePage().route).toBe('/posts/[id]')
        expect(activePage().params).toEqual({ id: '42' })
        expect(activePage().url.pathname).toBe('/posts/42')
    })

    test('a swapped resolver fully changes the snapshot — no shared singleton', () => {
        const first: PageSnapshot = {
            route: '/a',
            params: { tab: 'one' },
            url: new URL('https://test.local/a'),
            navigating: false,
        }
        const second: PageSnapshot = {
            route: '/b',
            params: { tab: 'two' },
            url: new URL('https://test.local/b'),
            navigating: false,
        }

        pageSlot.resolver = () => first
        expect(activePage().route).toBe('/a')
        expect(activePage().params.tab).toBe('one')

        /* A second concurrent request swaps the scope; resolution follows it with no leak. */
        pageSlot.resolver = () => second
        expect(activePage().route).toBe('/b')
        expect(activePage().params.tab).toBe('two')
        expect(activePage().url.pathname).toBe('/b')
    })

    test('a resolver returning undefined falls through to the empty fallback', () => {
        /* The server resolver returns undefined outside a request scope (no ALS store). */
        pageSlot.resolver = () => undefined

        expect(activePage().route).toBe('')
        expect(activePage().params).toEqual({})
        expect(activePage().url.pathname).toBe('/')
    })

    test('falls back to an empty snapshot when no resolver is registered', () => {
        expect(activePage().route).toBe('')
        expect(activePage().params).toEqual({})
        expect(activePage().url.pathname).toBe('/')
    })
})
