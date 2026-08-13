// Does every use case still SERVE?
//
// This app had no assertions at all. It is driven from outside — a harness in `~/code` clicks its
// buttons and reads its counters — so nothing in this repo noticed if a page stopped rendering, and the
// failure would arrive as a comparison run reporting nonsense on a Tuesday afternoon.
//
// What is asserted here is deliberately shallow, and the shape of the claim is the point: a use case is a
// PAGE, so the claim is that the route table still names it, that a server render still produces its
// markup, and that the HANDLES an external harness reaches for are still in it. Anything about what an op
// COSTS belongs in a browser — absolute milliseconds out of happy-dom describe the emulator.
//
// The route table is read off the directory the way `abide start` reads it, so a page added under
// `pages/` is covered by this the moment it exists rather than when somebody remembers to list it.

import { expect, test } from 'bun:test'
import { isolate } from '$shared/internal/scopes.ts'
import { outlet, routes } from 'abide/runtime'
import { navigate } from 'abide'
import { pages, renderToString } from 'abide/server'

const HERE = new URL('../pages/', import.meta.url)

/** Every use case, and the handles the external harness drives it by. */
const CASES: { path: string; contains: string[]; ids: string[] }[] = [
    { path: '/', contains: ['simple', '<li'], ids: ['count', 'inc'] },
    { path: '/data', contains: ['<h1', 'shard'], ids: ['query', 'sort', 'rows', 'summary', 'runs'] },
    { path: '/complex', contains: ['<table', '<tr'], ids: ['create', 'update', 'swap', 'rows'] },
    { path: '/media', contains: ['<h1'], ids: ['media', 'query', 'sort'] },
    { path: '/dashboard', contains: ['<table', '<tr'], ids: ['records', 'filter', 'active'] },
    { path: '/wake', contains: ['wake'], ids: ['wake-run', 'wake-out'] },
]

const served = async (path: string): Promise<string> => {
    routes(await pages(HERE))
    return await isolate(async () => {
        await navigate(path)
        return renderToString(outlet())
    })
}

test('the directory is the route table, and every use case is in it', async () => {
    const table = await pages(HERE)
    const paths = table.map((entry) => entry.path).sort()
    expect(paths).toEqual(['/', '/complex', '/dashboard', '/data', '/media', '/wake'])
    // Every case below names a route that exists — so a case for a page nobody serves fails here rather
    // than passing vacuously against an empty render.
    for (const shown of CASES) expect(paths, `${shown.path} is served`).toContain(shown.path)
})

for (const shown of CASES) {
    test(`${shown.path} renders, with the handles a harness drives it by`, async () => {
        const markup = await served(shown.path)
        expect(markup.length, `${shown.path} rendered nothing`).toBeGreaterThan(100)
        for (const text of shown.contains) {
            expect(markup, `${shown.path} is missing ${text}`).toContain(text)
        }
        // The IDS are the contract with the harness, and the only part of these pages that is not free
        // to change: a renamed button is a comparison arm that silently measures nothing.
        for (const id of shown.ids) {
            expect(markup, `${shown.path} no longer has #${id}`).toContain(`id="${id}"`)
        }
    })
}

test('the shell ships no stylesheet, and that is load-bearing', async () => {
    // One CSS rule was the whole of a "4.5x faster" reading: Blink builds its style invalidation sets
    // from the stylesheets, so on an unstyled page writing a class that matches no rule recalculates no
    // style and paints nothing. Five of six comparison arms were unstyled and this one was not, which is
    // the entire gap that was being read as a framework difference.
    //
    // So this is a real assertion rather than a note: a stylesheet reaching this shell invalidates every
    // number the comparison has ever produced.
    const shell = await Bun.file(new URL('../app.html', import.meta.url)).text()
    expect(shell).not.toContain('<style')
    expect(shell).not.toContain('rel="stylesheet"')
    expect(shell).not.toContain('.css')
})
