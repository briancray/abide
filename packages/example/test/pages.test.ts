// `pages()` — the filesystem half of routing, which is the one half that is not isomorphic.
//
// Not a demo, and for the same reason `serve` is not one: a demo case runs the same body headless
// AND inside a browser card, and a browser cannot read a directory. Everything about routing that a
// card CAN show is in `demos/routing.ts`, driven by a hand-written table — which is the same shape
// this produces, so nothing here is a second implementation of anything.
//
// The pages under `packages/example/pages` are real `.abide` files, imported through the compiler
// plugin exactly as an app's would be. That is what makes this a test of the seam rather than of a
// mock: a layout's `<slot/>` really does receive the page below it.

import { expect, test } from 'bun:test'
import { navigate } from 'abide'
import { isolate } from '$shared/internal/scopes.ts'
import { outlet, routes } from 'abide/runtime'
import { pages, renderToString } from 'abide/server'

const HERE = new URL('../pages/', import.meta.url)

test('a directory is a pattern and a filename is a kind', async () => {
    const table = await pages(HERE)
    const paths = table.map((entry) => entry.path).sort()
    // `[suite]/[...rest]` is the site's twenty capability pages behind one file, and it is the row
    // that makes precedence load-bearing here rather than only in `demos/routing.ts`: `/users/42` and
    // `/bench` both match it, and both are answered by the literal that outranks it.
    expect(paths).toEqual([
        '/',
        '/[suite]/[...rest]',
        '/bench',
        '/files/[...path]',
        '/streaming',
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
    expect(markup).toContain('href="/state"')
})

test('a rest segment reaches the page as the joined remainder', async () => {
    routes(await pages(HERE))
    const markup = await isolate(async () => {
        await navigate('/files/notes/2026/q1.md')
        return renderToString(outlet())
    })
    expect(markup).toContain('files notes/2026/q1.md')
})
