import { afterEach, describe, expect, test } from 'bun:test'
import { page } from '../src/lib/shared/page.ts'
import { pageSlot } from '../src/lib/shared/pageSlot.ts'
import { setPageResolver } from '../src/lib/shared/setPageResolver.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { matchRoute } from '../src/lib/ui/matchRoute.ts'
import { clientPage } from '../src/lib/ui/runtime/clientPage.ts'

afterEach(() => {
    pageSlot.resolver = undefined
    pageSlot.fallback = undefined
})

describe('matchRoute', () => {
    const routes = ['/', '/about', '/post/[id]', '/post/new', '/docs/[...rest]']

    test('matches a static route exactly', () => {
        expect(matchRoute(routes, '/about')).toEqual({ route: '/about', params: {} })
    })

    test('decodes a [param] segment', () => {
        expect(matchRoute(routes, '/post/42')).toEqual({
            route: '/post/[id]',
            params: { id: '42' },
        })
    })

    test('a static route beats a param route at the same depth', () => {
        expect(matchRoute(routes, '/post/new')).toEqual({ route: '/post/new', params: {} })
    })

    test('a [...catch-all] consumes the remaining segments', () => {
        expect(matchRoute(routes, '/docs/guide/intro')).toEqual({
            route: '/docs/[...rest]',
            params: { rest: 'guide/intro' },
        })
    })

    test('no pattern matches → undefined', () => {
        expect(matchRoute(routes, '/nope/here')).toBeUndefined()
    })
})

describe('page proxy', () => {
    test('reads route/params/url off the active resolver', () => {
        setPageResolver(() => ({
            route: '/post/[id]',
            params: { id: '7' },
            url: new URL('https://app.test/post/7'),
            navigating: false,
        }))
        expect(page.route).toBe('/post/[id]')
        expect(page.params.id).toBe('7')
        expect(page.url.pathname).toBe('/post/7')
        expect(page.navigating).toBe(false)
    })

    test('is reactive: reading page.url in an effect re-runs when clientPage updates', () => {
        setPageResolver(() => clientPage.value)
        clientPage.value = {
            route: '/',
            params: {},
            url: new URL('https://app.test/'),
            navigating: false,
        }
        let seen: string | undefined
        const stop = effect(() => {
            seen = page.url.pathname
        })
        expect(seen).toBe('/')

        clientPage.value = {
            route: '/next',
            params: {},
            url: new URL('https://app.test/next'),
            navigating: false,
        }
        expect(seen).toBe('/next') // the effect re-ran on the navigation update
        stop()
    })
})
