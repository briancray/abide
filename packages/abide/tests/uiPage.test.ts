import { afterEach, describe, expect, test } from 'bun:test'
import { matchRoute } from '../src/lib/shared/matchRoute.ts'
import { page } from '../src/lib/shared/page.ts'
import { pageSlot } from '../src/lib/shared/pageSlot.ts'
import { effect } from '../src/lib/ui/effect.ts'
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
        pageSlot.resolver = () => ({
            route: '/post/[id]',
            params: { id: '7' },
            url: new URL('https://app.test/post/7'),
            navigating: false,
        })
        expect(page.route).toBe('/post/[id]')
        expect(page.params.id).toBe('7')
        expect(page.url.pathname).toBe('/post/7')
        expect(page.navigating).toBe(false)
    })

    test('params are granular: a reader of one param does not wake on another param change', () => {
        pageSlot.resolver = () => clientPage.value
        clientPage.value = {
            route: '/media/[id]/[...rest]',
            params: { id: '87755', rest: 's/1/e/1' },
            url: new URL('https://app.test/media/87755/s/1/e/1'),
            navigating: false,
        }
        let idReads = 0
        let restReads = 0
        const stopId = effect(() => {
            void page.params.id
            idReads += 1
        })
        const stopRest = effect(() => {
            void page.params.rest
            restReads += 1
        })
        expect([idReads, restReads]).toEqual([1, 1])

        // step the episode: only `rest` changes — the id reader must stay asleep
        clientPage.value = {
            route: '/media/[id]/[...rest]',
            params: { id: '87755', rest: 's/1/e/2' },
            url: new URL('https://app.test/media/87755/s/1/e/2'),
            navigating: false,
        }
        expect(idReads).toBe(1) // granular: unchanged id did not wake
        expect(restReads).toBe(2) // rest changed → its reader woke

        // change the id → its reader wakes
        clientPage.value = {
            route: '/media/[id]/[...rest]',
            params: { id: '99999', rest: 's/1/e/2' },
            url: new URL('https://app.test/media/99999/s/1/e/2'),
            navigating: false,
        }
        expect(idReads).toBe(2)
        stopId()
        stopRest()
    })

    test('a param the new route drops reads back undefined and wakes its reader', () => {
        pageSlot.resolver = () => clientPage.value
        clientPage.value = {
            route: '/media/[id]/[...rest]',
            params: { id: '1', rest: 'a' },
            url: new URL('https://app.test/media/1/a'),
            navigating: false,
        }
        const seen: (string | undefined)[] = []
        const stop = effect(() => {
            seen.push(page.params.rest)
        })
        expect(seen).toEqual(['a'])
        clientPage.value = {
            route: '/media/[id]',
            params: { id: '1' },
            url: new URL('https://app.test/media/1'),
            navigating: false,
        }
        expect(seen).toEqual(['a', undefined]) // the dropped param cleared and woke
        stop()
    })

    test('is reactive: reading page.url in an effect re-runs when clientPage updates', () => {
        pageSlot.resolver = () => clientPage.value
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
