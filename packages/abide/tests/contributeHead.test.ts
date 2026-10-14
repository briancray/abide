// 39.1 — A COMPONENT'S HEAD JOINS ITS LEVEL'S, however many of it a level mounts, and 39.14 — leaves
// with it. A `Level` alone, with no router: the head is the level's to hold, apply and hand back.

import { expect, test } from 'bun:test'
import { withdrawHead } from '#ui/applyHead.ts'
import { contributeHead, Level } from '#ui/Level.ts'
import type { Region } from '#ui/regions.ts'

/** A region with `content` between its anchors — empty for one the client fills. */
function region(content: Node[]): Region {
    const open = document.createComment('')
    const close = document.createComment('')
    document.createElement('div').append(open, ...content, close)
    return { open, close }
}

// THE REVERT: fold each contribution into the level's head as `() => outer() + head()` — a level of
// 100,000 rows reads through 100,000 nested calls and overflows the stack.
test("a level's head reads every row's contribution in one walk — 39.1", () => {
    const level = new Level([], 0)
    level.setHead(() => '<title>page</title>')
    // A region the server painted: nothing is applied, only joined.
    const painted = region([document.createElement('i')])
    level.mount(() => {
        for (let row = 0; row < 100_000; row += 1)
            contributeHead(painted, () => '<i>')
    })
    const head = level.headMarkup()
    expect(head.startsWith('<title>page</title><i>')).toBe(true)
    expect(head.length).toBe('<title>page</title>'.length + 3 * 100_000)
})

// THE REVERT: drop `Level.mounting = this` from `mount`; the component's head is never applied and
// the title stays `Layout`, and nothing is withdrawn after. 39.16 — drop the keyless removal from
// `withdrawHead`, and the `x-frame` the page brought outlives it.
test("a component's head lands with its level and leaves with it — 39.1, 39.14, 39.16", () => {
    document.head.innerHTML = '<title>Layout</title>'
    const levels: Level[] = []
    const layout = new Level(levels, 0)
    layout.setHead(() => '<title>Layout</title>')
    const page = new Level(levels, 1)
    levels.push(layout, page)
    // An empty region is one the client builds, so its head is applied once the level is mounted.
    page.mount(() => {
        contributeHead(
            region([]),
            () =>
                '<title>Framed</title><meta name="description" content="d"><meta http-equiv="x-frame" content="f">',
        )
        // Not applied a component at a time.
        expect(document.title).toBe('Layout')
    })
    expect(document.title).toBe('Framed')
    expect(document.head.querySelector('meta[name="description"]')).not.toBe(
        null,
    )
    // A row grown after the mount titles nothing.
    contributeHead(region([]), () => '<title>Row</title>')
    expect(page.headMarkup()).not.toContain('Row')

    // The page leaves for one keying nothing: what it keyed goes back to the layout's, or leaves.
    withdrawHead(Level.headsOf(levels, 1, 2), () => [
        Level.headsOf(levels, 0, 1),
        '',
    ])
    expect(document.title).toBe('Layout')
    expect(document.head.querySelector('meta[name="description"]')).toBe(null)
    expect(document.head.querySelector('meta[http-equiv]')).toBe(null)
})
