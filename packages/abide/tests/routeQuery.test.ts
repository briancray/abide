// 30.40 to 30.47 — THE QUERY AS ONE VALUE: read off an address by the defaults it is asked with, and
// written by navigating. The address here is a plain `Reactive<URL>` and the router a stand-in that
// moves it, so what is counted is the navigations a write makes rather than what a router does
// with them — `routing.test.ts` holds the same writes against the real router and its history.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, reactive, route, url } from '#shared'
import { CURRENT_ROUTER, type NavigateOptions } from '#shared/CURRENT_ROUTER.ts'
import { routeQuery } from '#shared/routeQuery.ts'

const DEFAULTS = { watch: 0, tab: 'all', open: false, tags: [] as string[] }

/** A router that moves `address` to where it is sent, and keeps what it was sent. */
function standIn(address: { set(next: URL): unknown }): {
    went: [string, NavigateOptions][]
} {
    const went: [string, NavigateOptions][] = []
    CURRENT_ROUTER.current = {
        go: async (to, options) => {
            went.push([String(to), options])
            address.set(new URL(to))
        },
        step: async () => {},
    }
    return { went }
}

afterEach(() => {
    CURRENT_ROUTER.current = null
})

test('each member is parsed by its default’s type — 30.41', () => {
    const address = reactive(
        new URL(
            'https://crm.invalid/deals?watch=3&tab=mine&open=true&tags=a&tags=b',
        ),
    )
    expect(routeQuery(address, DEFAULTS)()).toEqual({
        watch: 3,
        tab: 'mine',
        open: true,
        tags: ['a', 'b'],
    })
})

test('a member absent or unparseable reads its default — 30.42', () => {
    const address = reactive(
        new URL('https://crm.invalid/deals?watch=three&open=yes'),
    )
    expect(routeQuery(address, DEFAULTS)()).toEqual(DEFAULTS)
    address.set(new URL('https://crm.invalid/deals?watch='))
    expect(routeQuery(address, DEFAULTS)().watch).toBe(0)
})

// 30.28 — `tags` with no `=` is the empty list, and `tags=` the list holding ''.
test('a list member named with no `=` reads as the empty list — 30.41', () => {
    const address = reactive(new URL('https://crm.invalid/deals?tags'))
    const query = routeQuery(address, { tags: ['open'] })
    expect(query().tags).toEqual([])
    address.set(new URL('https://crm.invalid/deals?tags='))
    expect(query().tags).toEqual([''])
})

test('url leaves out a member spelled as its default — 30.40', () => {
    expect(
        url(
            '/deals',
            undefined,
            { watch: 0, tab: 'mine', tags: [] },
            { watch: 0, tab: 'all', tags: [] },
        ),
    ).toBe('/deals?tab=mine')
    expect(
        url('/deals', undefined, new URLSearchParams('watch=0&tab=mine'), {
            watch: 0,
        }),
    ).toBe('/deals?tab=mine')
    // A list differing from its default is written, the empty one as its bare name (30.28).
    expect(url('/deals', undefined, { tags: [] }, { tags: ['open'] })).toBe(
        '/deals?tags',
    )
})

test('a set replaces the query, and a member it leaves out goes back to its default — 30.43', () => {
    const address = reactive(
        new URL('https://crm.invalid/deals?watch=3&tab=mine#notes'),
    )
    const { went } = standIn(address)
    const query = routeQuery(address, DEFAULTS)
    query.set({ open: true })
    expect(went).toEqual([
        [
            'https://crm.invalid/deals?open=true#notes',
            { replace: true, keepScroll: true },
        ],
    ])
    expect(query()).toEqual({ ...DEFAULTS, open: true })
})

// What `query.watch = 4` lowers to (31.8): a copy of the value with the one member changed, set.
test('a write through one member changes that member alone — 30.43, 31.8', () => {
    const address = reactive(
        new URL('https://crm.invalid/deals?watch=3&tab=mine'),
    )
    const { went } = standIn(address)
    const query = routeQuery(address, DEFAULTS)
    query.set({ ...query(), watch: 4 })
    expect(went.map(([to]) => to)).toEqual([
        'https://crm.invalid/deals?watch=4&tab=mine',
    ])
    query.set({ ...query(), tab: 'all' })
    expect(went.map(([to]) => to)).toEqual([
        'https://crm.invalid/deals?watch=4&tab=mine',
        'https://crm.invalid/deals?watch=4',
    ])
})

test('a write leaves every member its defaults do not name where it stands — 30.45', () => {
    const address = reactive(
        new URL('https://crm.invalid/deals?q=hopper&watch=3&sort'),
    )
    const { went } = standIn(address)
    routeQuery(address, { watch: 0 }).set({ watch: 0 })
    expect(went.map(([to]) => to)).toEqual([
        'https://crm.invalid/deals?q=hopper&sort',
    ])
})

test('a write with no router in the document throws, as navigate refuses — 30.46', () => {
    const address = reactive(new URL('https://crm.invalid/deals'))
    expect(() => routeQuery(address, DEFAULTS).set({ watch: 1 })).toThrow(
        /no router in this document/,
    )
})

// A wake count, because a reader that woke reads the same value either way.
// THE REVERT: pass no `identity` to `pairReactive` in `routeQuery`; this reports 1 wake against 0.
test('a change to a member the defaults do not name wakes no reader — 30.47', () => {
    const address = reactive(new URL('https://crm.invalid/deals?watch=3'))
    const query = routeQuery(address, DEFAULTS)
    let woken = -1
    const stop = query.watch(() => {
        woken += 1
    })
    address.set(new URL('https://crm.invalid/deals?watch=3&q=hopper#notes'))
    flushSync()
    expect(`wakes: ${woken}`).toBe('wakes: 0')
    address.set(new URL('https://crm.invalid/deals?watch=4'))
    flushSync()
    expect(`wakes: ${woken}`).toBe('wakes: 1')
    stop()
})

// 30.41 — THE TYPE IS THE DEFAULTS', widened from their literals. The `@ts-expect-error` lines are the
// gate: `bun run typecheck` fails where one of them stops being an error.
test('the value is typed by its defaults — 30.41', () => {
    const typed = (): void => {
        const query = route.query({
            watch: 0,
            tab: 'all',
            open: false,
            tags: [] as string[],
        })
        const read: {
            watch: number
            tab: string
            open: boolean
            tags: string[]
        } = query()
        query.set({ tab: 'mine' })
        // @ts-expect-error — a member is written as its default's type.
        query.set({ watch: '3' })
        // @ts-expect-error — and only a member the defaults name.
        query.set({ sort: 'name' })
        // @ts-expect-error — a default is text, a number, a flag or a list of text.
        route.query({ since: new Date() })
        void read
    }
    expect(typeof typed).toBe('function')
})
