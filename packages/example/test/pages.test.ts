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
import { isolate, navigate, outlet, routes } from 'abide'
import { pages, renderToString } from 'abide/server'

const HERE = new URL('../pages/', import.meta.url)

test('a directory is a pattern and a filename is a kind', async () => {
    const table = await pages(HERE)
    const paths = table.map((entry) => entry.path).sort()
    expect(paths).toEqual(['/', '/files/[...path]', '/users/[id]'])
})

test('every layout above a page wraps it, outermost first', async () => {
    const table = await pages(HERE)
    const user = table.find((entry) => entry.path === '/users/[id]')
    expect(user?.layouts?.length).toBe(2)
    const home = table.find((entry) => entry.path === '/')
    expect(home?.layouts?.length).toBe(1)
})

test('a page renders through its layouts, with its params', async () => {
    routes(await pages(HERE))
    const markup = await isolate(async () => {
        await navigate('/users/42')
        return renderToString(outlet())
    })
    expect(markup).toContain('<main>')
    expect(markup).toContain('<section class="users">')
    expect(markup).toContain('user 42')
    // The outer layout reads the ambient too, and a server render is a snapshot of THIS caller.
    expect(markup).toContain('/users/42')
})

test('a rest segment reaches the page as the joined remainder', async () => {
    routes(await pages(HERE))
    const markup = await isolate(async () => {
        await navigate('/files/notes/2026/q1.md')
        return renderToString(outlet())
    })
    expect(markup).toContain('files notes/2026/q1.md')
})
