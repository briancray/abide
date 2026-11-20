// 35.20, 35.24 — A COMPONENT HANDED TO A NAMED PLACE: `fill` stands its component under its name for as
// long as the setup that made it stands, in the order the fills were made, and warns once where no
// `Outlet` of the name has stood. Where the `Outlet` renders them, and the server painting them in
// place, is the CRM's tests', which mount it.

import { expect, test } from 'bun:test'

import { fill, fillings, stood } from '#shared/fill.ts'
import { collectWatches } from '#shared/reactive/watch.ts'

const Export = (): string => 'Export'
const Share = (): string => 'Share'

// A fill made as a component's setup makes it: its watches collected, and stopped as it leaves.
function made(body: () => void): () => void {
    const stops: (() => void)[] = []
    const previous = collectWatches(stops)
    body()
    collectWatches(previous)
    return () => {
        for (const stop of stops) stop()
    }
}

async function warnings(body: () => void): Promise<string[]> {
    const warned: string[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]): void => {
        const line = args.join(' ')
        if (line.includes('abide:fill')) warned.push(line)
    }
    try {
        body()
        await new Promise((settled) => setTimeout(settled, 5))
    } finally {
        console.warn = warn
    }
    return warned
}

// FIRST IN THE FILE, since the warning is given once per process. THE REVERT: drop the check from
// `fill`, and a toolbar no layout renders is filled without a word.
test('a fill no Outlet of its name has stood under warns once — 35.24', async () => {
    stood.add('toolbar')
    const filled: (() => void)[] = []
    expect(
        await warnings(() => filled.push(made(() => fill('toolbar', Export)))),
    ).toEqual([])
    const first = await warnings(() => {
        filled.push(made(() => fill('sidebar', Export)))
        filled.push(made(() => fill('sidebar', Share)))
    })
    for (const leave of filled) leave()
    expect(first).toHaveLength(1)
    expect(first[0]).toContain('<Outlet name="sidebar" />')
})

// THE REVERT: drop the disposer `fill`'s watch hands back, and a page navigated away from leaves its
// action in the toolbar.
test('fills stand in the order they were made, and each leaves with its setup — 35.20', () => {
    const before = fillings.peek()?.length ?? 0
    const first = made(() => fill('actions', Export, { label: 'Export' }))
    const second = made(() => fill('actions', Share))
    const mine = () => (fillings.peek() ?? []).slice(before)
    expect(mine().map((filling) => filling.Component)).toEqual([Export, Share])
    expect(mine()[0]?.props).toEqual({ label: 'Export' })
    first()
    expect(mine().map((filling) => filling.Component)).toEqual([Share])
    second()
    expect(mine()).toEqual([])
})
