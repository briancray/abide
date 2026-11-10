// 39.1 — A COMPONENT'S HEAD JOINS ITS LEVEL'S, however many of it a level mounts, and 39.14 — leaves
// with it. A `Level` alone, with no router: the head is the chain's, reconciled from all of it.

import { expect, test } from 'bun:test'

import { flushSync, reactive } from '#shared/reactive/index.ts'
import { enterShare, leaveShare } from '#shared/reactive/share.ts'
import { contributeHead, type HeadContribution, Level } from '#ui/Level.ts'
import { reconcileHead } from '#ui/reconcileHead.ts'
import type { Region } from '#ui/regions.ts'

import { warningsWhile } from './warningsWhile.ts'

/** What a level reconciles through: the head of `levels`, as a `LevelChain` reconciles its own. */
const chainOf = (levels: Level[]) => ({
    reconcile: () => Level.reconcile(levels),
})

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
    const levels: Level[] = []
    const level = new Level(chainOf(levels))
    levels.push(level)
    level.setHead(() => '<title>page</title>')
    // A region the server painted: nothing is reconciled, only joined.
    const painted = region([document.createElement('i')])
    level.mount(() => {
        for (let row = 0; row < 100_000; row += 1)
            contributeHead(painted, () => '<i>')
    })
    const chain = Level.contributors(levels)
    expect(chain[0]?.[1]).toBe('<title>page</title>')
    expect(chain.length).toBe(1 + 100_000)
})

// THE REVERT: drop `reconcileLater(this.chain)` from `contribute`; the component's head is never
// written and the title stays `Layout`. 39.16 — reconcile without dropping the contributors that left, and
// the `x-frame` the page brought outlives it.
test("a component's head lands with its level and leaves with it — 39.1, 39.14, 39.16", () => {
    document.head.innerHTML = '<title>Layout</title>'
    const levels: Level[] = []
    const layout = new Level(chainOf(levels))
    layout.setHead(() => '<title>Layout</title>')
    const page = new Level(chainOf(levels))
    levels.push(layout, page)
    // An empty region is one the client builds, so its head is written at the end of the turn.
    page.mount(() => {
        contributeHead(
            region([]),
            () =>
                '<title>Framed</title><meta name="description" content="d"><meta http-equiv="x-frame" content="f">',
        )
        // Not written a component at a time.
        expect(document.title).toBe('Layout')
    })
    flushSync()
    expect(document.title).toBe('Framed')
    expect(document.head.querySelector('meta[name="description"]')).not.toBe(
        null,
    )
    // A row grown after the mount titles nothing: no level is mounting to join.
    expect(contributeHead(region([]), () => '<title>Row</title>')).toBe(
        undefined,
    )

    // The page leaves for nothing: what it keyed goes back to the layout's, or leaves.
    levels.length = 1
    Level.reconcile(levels)
    expect(document.title).toBe('Layout')
    expect(document.head.querySelector('meta[name="description"]')).toBe(null)
    expect(document.head.querySelector('meta[http-equiv]')).toBe(null)
})

// 39.16 — A CONTRIBUTOR'S KEYLESS NODES ARE ITS OWN, even where another wrote the same one. A page
// that repeats one of its layout's stylesheets takes its own copy when it leaves, and the layout's
// stand where they stood — the cascade the layout alone renders.
//
// THE REVERT: drop the `claimed` check from `adopt`. The page then adopts the layout's
// `p{color:red}` as its own and takes it on the way out — this reports `p{color:blue} |
// p{color:red}`, the two stylesheets in the wrong order, and `p` paints red.
test('a contributor takes only its own keyless nodes when it leaves — 39.16', () => {
    const layoutHead =
        '<title>L</title><style>p{color:red}</style><style>p{color:blue}</style>'
    const pageHead = '<style>p{color:red}</style>'
    // The server painted both, layout first.
    document.head.innerHTML = layoutHead + pageHead
    const levels: Level[] = []
    const layout = new Level(chainOf(levels))
    layout.setHead(() => layoutHead)
    const page = new Level(chainOf(levels))
    page.setHead(() => pageHead)
    levels.push(layout, page)
    const order = () =>
        [...document.head.querySelectorAll('style')]
            .map((style) => style.textContent)
            .join(' | ')

    // A navigation reconciles before it stops the leaving levels, adopting what they painted.
    Level.reconcile(levels)
    expect(order()).toBe('p{color:red} | p{color:blue} | p{color:red}')
    levels.length = 1
    Level.reconcile(levels)
    expect(order()).toBe('p{color:red} | p{color:blue}')
})

// 39.17 — A `<script>` A CLIENT WRITES INTO THE HEAD RUNS, as the one a server painted does. The
// fragment parser marks every script it makes "already started", and happy-dom models that once
// it evaluates scripts at all — which this preload leaves off, so the case turns it on for itself.
// Chromium and WebKit answer the same three numbers.
//
// THE REVERT: `runnable` handing the parsed node back as it came — `first: 0, again: 0, changed: 0`.
test('a head script a client writes runs once, and again only when it changes — 39.15, 39.16, 39.17', () => {
    const settings = (
        window as unknown as {
            happyDOM: { settings: { enableJavaScriptEvaluation: boolean } }
        }
    ).happyDOM.settings
    const record = globalThis as unknown as { headScriptRuns: number }
    record.headScriptRuns = 0
    document.head.innerHTML = '<title>Layout</title>'
    const once = '<script>globalThis.headScriptRuns += 1</script>'
    const changed = '<script>globalThis.headScriptRuns += 10</script>'
    const contributor = {}
    settings.enableJavaScriptEvaluation = true
    let first = 0
    let again = 0
    try {
        reconcileHead([[contributor, once]])
        first = record.headScriptRuns
        // Reconciled again unchanged, the standing script is left standing and not run twice.
        reconcileHead([[contributor, once]])
        again = record.headScriptRuns
        reconcileHead([[contributor, changed]])
    } finally {
        settings.enableJavaScriptEvaluation = false
    }
    expect(
        `first: ${first}, again: ${again}, changed: ${record.headScriptRuns}`,
    ).toBe('first: 1, again: 1, changed: 11')
    expect(document.head.querySelectorAll('script').length).toBe(1)
    reconcileHead([])
    expect(document.head.querySelectorAll('script').length).toBe(0)
})

// A LIST GROWN OR EMPTIED BY N ROWS RECONCILES THE HEAD ONCE, NOT ONCE A ROW: each reconcile walks
// every contributor, so one a row is N², and in chromium past a frame at ~400 rows. THE REVERT:
// `this.reconcile()` for `reconcileLater(...)` in `contribute` and `stop`; this reports 100
// reconciles where 1 is due.
test('rows grown after their level mount reconcile the head once a turn — 39.13, 39.16', () => {
    for (const size of [100, 1000]) {
        document.head.innerHTML = '<title>page</title>'
        const levels: Level[] = []
        let reconciles = 0
        const level = new Level({
            reconcile: () => {
                reconciles += 1
                Level.reconcile(levels)
            },
        })
        levels.push(level)
        level.setHead(() => '<title>page</title>')
        // Rows mounted after the level, into regions the client builds.
        const back = enterShare(level)
        const rows: (HeadContribution | undefined)[] = []
        for (let row = 0; row < size; row += 1)
            rows.push(
                contributeHead(
                    region([]),
                    () => `<style>.row-${row}{}</style>`,
                ),
            )
        leaveShare(back)
        flushSync()
        expect({ size, reconciles }).toEqual({ size, reconciles: 1 })
        expect(document.head.querySelectorAll('style').length).toBe(size)
        for (const row of rows) row?.stop()
        flushSync()
        expect({ size, reconciles }).toEqual({ size, reconciles: 2 })
        expect(document.head.querySelectorAll('style').length).toBe(0)
    }
})

// 39.16 — ROWS JOINING IN ONE RECONCILE EACH WRITE THEIR OWN equal keyless node. THE REVERT: drop
// `claimed.add(node)` from `reconcileHead`'s write; the second row adopts the node the first just
// wrote as the server's, 2 stand where 3 are due, and the first leaving takes the second's too.
test('rows joining in one reconcile each own an equal keyless node — 39.16', () => {
    document.head.innerHTML = ''
    const levels: Level[] = []
    const level = new Level(chainOf(levels))
    levels.push(level)
    const rows: (HeadContribution | undefined)[] = []
    level.mount(() => {
        for (let row = 0; row < 3; row += 1)
            rows.push(contributeHead(region([]), () => '<style>.x{}</style>'))
    })
    flushSync()
    expect(document.head.querySelectorAll('style').length).toBe(3)
    rows[0]?.stop()
    flushSync()
    expect(document.head.querySelectorAll('style').length).toBe(2)
})

// A HEAD THAT THROWS COSTS ONE TURN'S RECONCILE, NOT EVERY ONE AFTER. A row's `<title>{x.name}</title>`
// reading a failed load throws inside the one watch every chain reconciles through; that stops the
// watch (12.8), and the next ask must open another. THE REVERT: reconcile `STALE` in place and clear
// it after, with no reset of `asked` — the throw leaves `STALE` full, no later ask bumps the watch,
// and this reports 2 reconciles and the leaving row's `.a` standing where 3 and `.b`, `.c` are due.
test('a contributor that throws does not stop the head reconciling — 12.8, 39.16', () => {
    document.head.innerHTML = '<title>page</title>'
    const levels: Level[] = []
    let reconciles = 0
    const level = new Level({
        reconcile: () => {
            reconciles += 1
            Level.reconcile(levels)
        },
    })
    levels.push(level)
    level.setHead(() => '<title>page</title>')
    const failing = reactive(false)
    const back = enterShare(level)
    // The drain surfaces each throw as uncaught (12.7); here it is only counted.
    const report = globalThis.reportError
    globalThis.reportError = () => {}
    let warned: string[]
    try {
        warned = warningsWhile(() => {
            const a = contributeHead(region([]), () => {
                if (failing()) throw new Error('failed load')
                return '<style>.a{}</style>'
            })
            flushSync()
            failing.set(true)
            flushSync()
            contributeHead(region([]), () => '<style>.b{}</style>')
            flushSync()
            a?.stop()
            contributeHead(region([]), () => '<style>.c{}</style>')
            flushSync()
        }, 'an effect threw')
    } finally {
        globalThis.reportError = report
        leaveShare(back)
    }
    // A's own watch, and the reconcile it threw inside.
    expect(warned.length).toBe(2)
    const styles = [...document.head.querySelectorAll('style')].map(
        (node) => node.textContent,
    )
    expect({ reconciles, styles }).toEqual({
        reconciles: 3,
        styles: ['.b{}', '.c{}'],
    })
})
