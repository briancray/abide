// HOW A NAVIGATION ENDS, decided apart from the router that executes it: a document load, a step
// within the standing page, or a mount. Each row is one clause's case, run through `outcomeOf` with
// nothing stubbed — the router's own execution of each outcome is `routing.test.ts`'s.
//
// THE REVERTS, run: drop the `found === undefined` arm, and 30.10's rows throw reading `route` of
// undefined; drop the status check, and 30.18's rows read `mount`; drop the `!heard.loaded` check,
// and 30.27's chunk row reads `mount`; mount `heard.found` at `target` whatever the answer says, and
// 30.17's rows read `/invoices/42`; drop either `standing` arm, and 30.23's rows read `ask` or
// `mount`.

import { describe, expect, test } from 'bun:test'

import { type Bearing, type Heard, outcomeOf } from '#ui/outcomeOf.ts'

const ORIGIN = 'http://localhost'
const INVOICE = 'invoice'
const HOME = 'home'

/** The two-route app every row navigates in: `/` and `/invoices/[id]`. */
function match(pathname: string) {
    if (pathname === '/') return { route: HOME, params: {} }
    const invoice = /^\/invoices\/([^/]+)$/.exec(pathname)
    return invoice === null
        ? undefined
        : { route: INVOICE, params: { id: invoice[1] as string } }
}

/** A bearing toward `to`, from the home page standing at `/` unless a row says otherwise. */
function toward(
    to: string,
    standing: Partial<Bearing<string>> = {},
): Bearing<string> {
    return {
        target: new URL(to, ORIGIN),
        origin: ORIGIN,
        errorPage: false,
        standing: HOME,
        mounted: '/',
        match,
        ...standing,
    }
}

/** What the ask heard: a go-ahead with every chunk loaded, online and pushing, unless overridden. */
function heard(
    bearing: Bearing<string>,
    over: Partial<Heard<string>> = {},
): Heard<string> {
    return {
        found: match(bearing.target.pathname) as Heard<string>['found'],
        answer: {
            status: 204,
            url: bearing.target.href,
            redirected: false,
        },
        loaded: true,
        online: true,
        pushed: true,
        ...over,
    }
}

/** The outcome's kind and the address it ends at, which is the whole of a row's claim. */
function ending(bearing: Bearing<string>, after?: Heard<string>) {
    const outcome =
        after === undefined ? outcomeOf(bearing) : outcomeOf(bearing, after)
    switch (outcome.kind) {
        case 'document':
        case 'offline':
            return [outcome.kind, new URL(outcome.href).pathname]
        case 'ask':
            return [outcome.kind, outcome.found.route]
        default:
            return [outcome.kind, outcome.at.pathname, outcome.found.route]
    }
}

describe('30.10 — an address no route matches is the document’s', () => {
    test('before the ask', () => {
        expect(ending(toward('/nowhere'))).toEqual(['document', '/nowhere'])
    })
    test('another origin, and an error page', () => {
        expect(ending(toward('http://elsewhere/invoices/1'))).toEqual([
            'document',
            '/invoices/1',
        ])
        expect(ending(toward('/invoices/1', { errorPage: true }))).toEqual([
            'document',
            '/invoices/1',
        ])
    })
    test('a redirect landing where no client route matches', () => {
        const bearing = toward('/invoices/42')
        const redirect = {
            status: 204,
            url: `${ORIGIN}/nowhere`,
            redirected: true,
        }
        expect(ending(bearing, heard(bearing, { answer: redirect }))).toEqual([
            'document',
            '/nowhere',
        ])
    })
})

describe('30.17 — a redirect is mounted where it landed', () => {
    test('at another route', () => {
        const bearing = toward('/invoices/42')
        const redirect = {
            status: 204,
            url: `${ORIGIN}/invoices/7`,
            redirected: true,
        }
        expect(ending(bearing, heard(bearing, { answer: redirect }))).toEqual([
            'mount',
            '/invoices/7',
            INVOICE,
        ])
    })
    test('at the route standing, which it follows', () => {
        const bearing = toward('/invoices/42')
        const redirect = { status: 204, url: `${ORIGIN}/`, redirected: true }
        expect(ending(bearing, heard(bearing, { answer: redirect }))).toEqual([
            'follow',
            '/',
            HOME,
        ])
    })
})

describe('30.18 — an answer other than 204 is the document’s', () => {
    for (const status of [200, 302, 403, 500])
        test(`${status}`, () => {
            const bearing = toward('/invoices/42')
            const answer = {
                status,
                url: `${ORIGIN}/signin`,
                redirected: false,
            }
            expect(ending(bearing, heard(bearing, { answer }))).toEqual([
                'document',
                '/signin',
            ])
        })
})

describe('30.23 — the route standing is followed, not remounted', () => {
    test('at its own path, without asking', () => {
        expect(ending(toward('/?genre=fantasy'))).toEqual(['follow', '/', HOME])
        expect(ending(toward('/#setup'))).toEqual(['follow', '/', HOME])
    })
    test('at another path, once asked (30.24)', () => {
        const standing = { standing: INVOICE, mounted: '/invoices/42' }
        const bearing = toward('/invoices/7', standing)
        expect(ending(bearing)).toEqual(['ask', INVOICE])
        expect(ending(bearing, heard(bearing))).toEqual([
            'follow',
            '/invoices/7',
            INVOICE,
        ])
    })
    test('another route is asked about, then mounted', () => {
        const bearing = toward('/invoices/42')
        expect(ending(bearing)).toEqual(['ask', INVOICE])
        expect(ending(bearing, heard(bearing))).toEqual([
            'mount',
            '/invoices/42',
            INVOICE,
        ])
    })
})

describe('30.27 — a failed request or load is the document’s', () => {
    test('a request that failed, online', () => {
        const bearing = toward('/invoices/42')
        expect(ending(bearing, heard(bearing, { answer: undefined }))).toEqual([
            'document',
            '/invoices/42',
        ])
    })
    test('chunks that would not load', () => {
        const bearing = toward('/invoices/42')
        expect(ending(bearing, heard(bearing, { loaded: false }))).toEqual([
            'document',
            '/invoices/42',
        ])
    })
    test('except offline, where 30.32 keeps the page', () => {
        const bearing = toward('/invoices/42')
        const offline = { answer: undefined, online: false }
        expect(ending(bearing, heard(bearing, offline))).toEqual([
            'offline',
            '/invoices/42',
        ])
        // A history step has already moved the bar, so it is the document's after all.
        expect(
            ending(bearing, heard(bearing, { ...offline, pushed: false })),
        ).toEqual(['document', '/invoices/42'])
    })
})
