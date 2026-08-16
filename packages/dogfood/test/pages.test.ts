// `pages()` — the filesystem half of routing, which is the one half that is not isomorphic.
//
// Not a demo, and for the same reason `serve` is not one: a demo case runs the same body headless
// AND inside a browser card, and a browser cannot read a directory. Everything about routing that a
// card CAN show is in `demos/routing.ts`, driven by a hand-written table — which is the same shape
// this produces, so nothing here is a second implementation of anything.
//
// The pages under `packages/dogfood/pages` are real `.abide` files, imported through the compiler
// plugin exactly as an app's would be. That is what makes this a test of the seam rather than of a
// mock: a layout's `<slot/>` really does receive the page below it.

import { expect, test } from 'bun:test'
import { navigate } from 'abide'
import { isolate } from '$shared/internal/scopes.ts'
import { outlet, routes } from 'abide/runtime'
import { renderToString } from 'abide/server/internal'
import { pages } from 'abide/server/internal'

const HERE = new URL('../pages/', import.meta.url)

test('a directory is a pattern and a filename is a kind', async () => {
    const table = await pages(HERE)
    const paths = table.map((entry) => entry.path).sort()
    // Three sections over TWO vocabularies: `/docs/[callable]` is one public name written down,
    // `/tests/[suite]/[...rest]` is a capability's cases running, and `/bench/[suite]` is what they cost.
    // Docs is keyed by callable and the other two by capability, because a reader looking up `cookies`
    // arrives with the name, and a reader pricing the request scope arrives with the capability.
    //
    // Each is a literal SECTION over a parameter, which is what makes precedence load-bearing here
    // rather than only in `demos/routing.ts`: `/docs` and `/docs/state` both exist, and the literal
    // outranks the parameter, so the index is reachable and so is every name under it.
    //
    // `[...rest]` is only on the tests route, and only because the routing suite's cases drive the
    // address bar for real: `/tests/routing/users/1` has to be that page rather than a 404, since a page
    // a browser can reach and a reload cannot is broken. Nothing under `/docs` or `/bench` navigates.
    expect(paths).toEqual([
        '/',
        '/bench',
        '/bench/[suite]',
        // A literal with no parameter under it, and the one route here that is not a view of THIS
        // app: `/demos` frames SEPARATE applications served under `/demo/<name>` by `bun run fleet`.
        // Nothing in this table answers those — they are other processes behind a front door, which
        // is exactly why they can ship a shell this app never could.
        '/demos',
        '/docs',
        '/docs/[callable]',
        // The second vocabulary, and the reason precedence is load-bearing twice over: `syntax` is a
        // literal sitting where `[callable]` matches anything, so the index below it is reachable only
        // because the literal outranks the parameter at that segment.
        '/docs/syntax',
        '/docs/syntax/[spelling]',
        '/files/[...path]',
        '/streaming',
        '/tests',
        '/tests/[suite]/[...rest]',
        '/users/[id]',
    ])
})

test('every layout above a page wraps it, outermost first', async () => {
    const table = await pages(HERE)
    const user = table.find((entry) => entry.path === '/users/[id]')
    expect(user?.layouts?.length).toBe(2)
    // The ORDER, which the count cannot see: the prefix walk in `pages()` pushes the root and then
    // descends, and an inverted walk emits the same two files and the same two counts. The render
    // test below cannot see it either — `toContain` finds both strings whichever one is outside —
    // and `demos/routing.ts` drives a table with a single layout, so this is the only line in the
    // package that fails when the nesting flips.
    // …read off `source`, because a loader is a closure and a closure has no address.
    expect(user?.source?.layouts).toEqual(['layout.abide', 'users/layout.abide'])
    const home = table.find((entry) => entry.path === '/')
    expect(home?.layouts?.length).toBe(1)
})

test('a page renders through its layouts, with its params', async () => {
    routes(await pages(HERE))
    const markup = await isolate(async () => {
        await navigate('/users/42')
        return renderToString(outlet())
    })
    expect(markup).toContain('<header')
    expect(markup).toContain('<section class="users">')
    expect(markup).toContain('user 42')
    // The outer layout reads the ambient too, and a server render is a snapshot of THIS caller: the
    // nav marks the section the URL is in, and `/users/42` is in none of them.
    expect(markup).toContain('href="/tests"')
})

test('a rest segment reaches the page as the joined remainder', async () => {
    routes(await pages(HERE))
    const markup = await isolate(async () => {
        await navigate('/files/notes/2026/q1.md')
        return renderToString(outlet())
    })
    expect(markup).toContain('files notes/2026/q1.md')
})
