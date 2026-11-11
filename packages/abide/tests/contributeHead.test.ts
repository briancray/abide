// 39.1 — A COMPONENT'S HEAD JOINS ITS LEVEL'S, however many of it a level mounts, and 39.14 — leaves
// with it. A `Level` alone, with no router: the head is the chain's, reconciled from all of it.

import { expect, test } from 'bun:test'

import { flushSync, reactive } from '#shared/reactive/index.ts'
import { enterShare, leaveShare } from '#shared/reactive/share.ts'
import { contributeHead, type HeadContribution, Level } from '#ui/Level.ts'
import { reconcileHead } from '#ui/reconcileHead.ts'
import type { Region } from '#ui/regions.ts'
import { Scope } from '#ui/Scope.ts'

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

// A HEAD THAT THROWS STANDS AS IT LAST READ (39.20). A row's `<title>{x.name}</title>` reading a
// failed load throws inside every reconcile of its chain — the end-of-turn one, and the synchronous
// one a painted contributor's `stop` runs to adopt what it painted. THE REVERT: read `one.head()`
// in `Level.contributors` — `p.stop()` throws out before `contributed.delete`, so this reports 1
// stop thrown, 2 contributors left, 3 reconciles and `.p`, `.a` standing where 0, 1, 4 and `.b`
// alone are due. REPORTED ONCE, by whichever read meets the throw first — its own watch here. THE
// REVERT: read `this.head()` in `follow` — the watch's throw goes out as an effect's, freezing
// nothing, and the next reconcile reports it again: 4 warnings where 2 are due.
test('a contributor that throws stands as it last read — 12.6, 39.16, 39.20', () => {
    document.head.innerHTML = '<title>page</title><style>.p{}</style>'
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
    // The drain surfaces each watch's throw as uncaught (12.7); here it is only counted.
    const report = globalThis.reportError
    globalThis.reportError = () => {}
    let stopsThrown = 0
    let warned: string[]
    try {
        warned = warningsWhile(() => {
            const a = contributeHead(region([]), () => {
                if (failing()) throw new Error('failed load')
                return '<style>.a{}</style>'
            })
            flushSync()
            // Painted, so nothing reconciles it until it stops.
            const painted = document.createElement('style')
            painted.textContent = '.p{}'
            const p = contributeHead(region([painted]), () => {
                if (failing()) throw new Error('failed load')
                return '<style>.p{}</style>'
            })
            failing.set(true)
            flushSync()
            try {
                p?.stop()
            } catch {
                stopsThrown += 1
            }
            flushSync()
            a?.stop()
            contributeHead(region([]), () => '<style>.b{}</style>')
            flushSync()
        }, 'threw')
    } finally {
        globalThis.reportError = report
        leaveShare(back)
    }
    const styles = [...document.head.querySelectorAll('style')].map(
        (node) => node.textContent,
    )
    // Warned: a's and p's own watches — none after.
    expect({
        warned: warned.length,
        stopsThrown,
        contributors: level.contributed.size,
        reconciles,
        styles,
    }).toEqual({
        warned: 2,
        stopsThrown: 0,
        contributors: 1,
        reconciles: 4,
        styles: ['.b{}'],
    })
})

// A PAINTED LEVEL STANDS AS THE SERVER WROTE IT (39.20). Nothing reconciles a hydrated level's head at
// mount, so its first client read may be the one that throws — a `<title>{deal.name}</title>` over a
// load that failed after paint — and what it last read is what its watch's first run saw. THE
// REVERT: read the level's head through a thunk of its own, seeded with `''`, in `contributors` —
// it stands as nothing, so the layout's `Layout` replaces `Page`, the painted `.page` is never
// adopted and outlives the page, and the throw is reported twice where once is due.
test('a painted level whose head throws stands as the server wrote it — 39.14, 39.16, 39.20', () => {
    document.head.innerHTML =
        '<title>Page</title><style>.layout{}</style><style>.page{}</style>'
    const levels: Level[] = []
    const layout = new Level(chainOf(levels))
    layout.setHead(() => '<title>Layout</title><style>.layout{}</style>')
    const page = new Level(chainOf(levels))
    const failing = reactive(false)
    page.setHead(() => {
        if (failing()) throw new Error('failed load')
        return '<title>Page</title><style>.page{}</style>'
    })
    levels.push(layout, page)
    const scope = new Scope()
    page.followHead(scope)
    const report = globalThis.reportError
    globalThis.reportError = () => {}
    const seen: { title: string; styles: (string | null)[] }[] = []
    const read = () =>
        seen.push({
            title: document.title,
            styles: [...document.head.querySelectorAll('style')].map(
                (node) => node.textContent,
            ),
        })
    let warned: string[]
    try {
        warned = warningsWhile(() => {
            failing.set(true)
            flushSync()
            // A navigation away reconciles with the page still standing, then without it.
            Level.reconcile(levels)
            read()
            scope.stop()
            levels.pop()
            Level.reconcile(levels)
            read()
        }, 'threw')
    } finally {
        globalThis.reportError = report
    }
    expect({ warned: warned.length, seen }).toEqual({
        warned: 1,
        seen: [
            { title: 'Page', styles: ['.layout{}', '.page{}'] },
            { title: 'Layout', styles: ['.layout{}'] },
        ],
    })
})
