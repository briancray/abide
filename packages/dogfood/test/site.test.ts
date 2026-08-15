// The site's own components, rendered.
//
// `bun test` cannot click a button, but it can prove that every page still BUILDS: that the chrome,
// the nav, and one card per case render without throwing. That is the half of the browser pages a
// demo-as-test does not already cover, and it is the half that breaks silently — a page that throws
// on load still returns 200.
//
// The cards are `.abide` components now, so this renders them the way the server does: a suite page
// server-renders with no case having RUN, because a case needs a live area and a live area is a
// browser's. What a card does once it HAS one is `demos/*.ts`, which `demos.test.ts` runs.

import { expect, test } from 'bun:test'
import { navigate } from 'abide'
import { isolate } from '$shared/internal/scopes.ts'
import { component } from 'abide/runtime'
import { renderToString } from 'abide/server/internal'
import { APPS } from '../demos/APPS.ts'
import { allSuites } from '../demos/index.ts'
import { NAV } from '../demos/SUITES.ts'
import Cases from '../site/cases.abide'
import Demo from '../site/demo.abide'
import { type Face, painted, scan, sliceOf } from '../site/code.ts'
import { marked, terms } from '../site/table.ts'

const SUITES = await allSuites()

test('every suite renders as a table of cases', async () => {
    for (const suite of SUITES) {
        const markup = await renderToString(
            component(Cases, { suites: [suite], title: suite.title, blurb: '' }),
        )
        expect(markup, `${suite.name} renders its title`).toContain(suite.title)
        // One `data-case` per case, which is what says a row was built for each of them rather than for
        // the ones that happened to have a `run`. Counted by the attribute rather than by the tag: a
        // source pane inside a row is a `<details>` too, so the tag counts rows AND their panes.
        const rows = markup.split('data-case=').length - 1
        expect(rows, `${suite.name} has one row per case`).toBe(suite.cases.length)
        // And no case ran: a live area arrives through `bind:element`, which is client-only. This is the
        // claim that makes a page of forty rows one server pass rather than forty.
        //
        // The BADGE's class rather than the word, since the toolbar grew a chip that spells it. A word
        // this page also uses as a label is not evidence about what any case did.
        expect(markup, `${suite.name} ran a case on the server`).not.toContain('is-passing')
    }
})

test('the nav is the four sections, and a capability page links to its other views', async () => {
    // Rendered through the layout the way a page is, so this is the nav an app actually serves — and
    // inside a caller that is SOMEWHERE, because the layout marks the section the URL is in and
    // `route()` refuses to guess where a caller with no request and no document is standing.
    const layout = (await import('../pages/layout.abide')).default
    const navAt = async (path: string): Promise<string> =>
        await isolate(async () => {
            await navigate(path)
            return renderToString(layout({ children: '' }))
        })

    // The SECTIONS, not the capabilities. Twenty capability links made the header the site's index; they
    // are indexed on the hub and reached from inside whichever section says which view of them you get.
    const sections = await navAt('/tests')
    for (const href of ['/docs', '/tests', '/bench']) {
        expect(sections, `the nav names ${href}`).toContain(`href="${href}"`)
    }
    for (const entry of NAV) {
        expect(sections, `the nav does not name ${entry.name} itself`).not.toContain(`href="/${entry.name}"`)
    }

    // And inside a capability, the OTHER view of it — two routes per capability rather than three, since
    // `/docs` moved to being keyed by callable. Offering `/docs/template` from `/bench/template` would be
    // a link to a 404: `html` is the name that suite documents, and the layout cannot know that.
    const inside = await navAt('/bench/memo')
    expect(inside).toContain('href="/tests/memo"')
    // Not a link to the page you are already on, and not one to a docs route that does not exist.
    expect(inside).not.toContain('href="/bench/memo"')
    expect(inside, 'the nav offers a suite name as a docs address').not.toContain('href="/docs/memo"')

    // A section page is not a capability, so it has no siblings to offer.
    expect(sections).not.toContain('href="/bench/tests"')
})

// --- the scanner both lanes share -------------------------------------------

test('scanning a demo file loses nothing and reorders nothing', async () => {
    for (const suite of SUITES) {
        const source = await Bun.file(new URL(`../demos/${suite.name}.ts`, import.meta.url)).text()
        // The spans cover the file COMPLETELY and in order, which is the whole contract: the pane
        // paints one `<span>` per span, so a scanner that dropped or repeated characters would show
        // code nobody wrote — and a colour is a matter of taste where this is not.
        let joined = ''
        for (const span of scan(source)) joined += source.slice(span.start, span.end)
        expect(joined, `${suite.name} survives the scan`).toBe(source)

        // And the painted form is the same text again, one class per token.
        let painted_ = ''
        for (const span of painted(source)) painted_ += span.text
        expect(painted_).toBe(source)
    }
})

test('every case body the runtime has is one the file can be sliced for', async () => {
    let found = 0
    for (const suite of SUITES) {
        const source = await Bun.file(new URL(`../demos/${suite.name}.ts`, import.meta.url)).text()
        for (const spec of suite.cases) {
            for (const face of ['run', 'server', 'interact'] as Face[]) {
                const body = spec[face]
                const cut = sliceOf(source, spec.title, face)
                if (body === undefined) {
                    // The other direction matters as much: a slice for a face the case does not have
                    // is the next case's body under this one's title, which is a pane that lies.
                    expect(cut, `${suite.name} · ${spec.title} has no ${face}`).toBeNull()
                    continue
                }
                expect(cut, `${suite.name} · ${spec.title} · ${face}`).not.toBeNull()
                const text = cut as string
                expect(text).toStartWith(body.constructor.name === 'AsyncFunction' ? 'async ' : face)
                expect(text.trimEnd()).toEndWith('}')

                // The whole body, not the signature. "ends with `}`" is true of `run({ is, log }`
                // too — a destructured parameter list closes a brace at the same depth the body's
                // does — and that truncation served one line as though it were the case.
                //
                // Compared against the RUNTIME's own text, which is this function after Bun stripped
                // its types: the file has strictly more in it than that, so a slice shorter than what
                // is running is a slice that stopped early.
                expect(
                    text.length,
                    `${suite.name} · ${spec.title} · ${face} is the whole body`,
                ).toBeGreaterThanOrEqual(body.toString().length)
                found++
            }
        }
    }
    expect(found).toBeGreaterThan(100)
})

// --- what the filter matched, painted ---------------------------------------

/**
 * `marked` is the WHERE behind `matches`'s whether, and it is checked the way the scanner next door
 * is: every character back, in order. The two lanes are the same shape of bug — a title painted from
 * runs that do not reassemble is a claim nobody wrote, and it reads as plausible.
 *
 * The queries are terms that OVERLAP on purpose. `re red` over `reduce` finds a run at 0 twice, and
 * an implementation that emits both writes `rered` where the title said `red`: the round trip is what
 * catches it, and nothing about the page would.
 */
const QUERIES = ['', 'a', 'the', 're red', 'a case', 'is is', 'ZZZZ', 'e']

test('a painted title is the title back, with every term inside a mark and none outside one', () => {
    let painted_ = 0
    for (const suite of SUITES) {
        for (const spec of suite.cases) {
            for (const query of QUERIES) {
                const wanted = terms(query)
                const runs = marked(spec.title, wanted)

                let joined = ''
                for (const run of runs) joined += run.text
                expect(joined, `${spec.title} · “${query}” survives painting`).toBe(spec.title)

                for (const run of runs) {
                    const lowered = run.text.toLowerCase()
                    let holds = false
                    for (const term of wanted) if (lowered.includes(term)) holds = true
                    // Both directions, because each catches a different half: a hit holding no term at
                    // all is a mark on text nobody typed, and a term sitting in an UNMARKED run is the
                    // occurrence the pass walked past — which is silent, since the title still reads
                    // correctly with one of its two matches dark.
                    if (run.hit) expect(holds, `“${run.text}” is marked for nothing`).toBe(true)
                    else expect(holds, `“${run.text}” holds a term and is not marked`).toBe(false)
                    if (run.hit) painted_++
                }
            }
        }
    }
    expect(painted_, 'no title was painted at all').toBeGreaterThan(100)
})

test('an unfiltered title is ONE plain run, and overlapping terms are ONE mark', () => {
    // The empty-query shape, and it is a cost claim rather than a looks claim: a page nobody has typed
    // into renders three hundred titles, and one run with no class on it is text rather than an element.
    expect(marked('a case', [])).toEqual([{ text: 'a case', hit: false }])
    expect(marked('a case', ['zz'])).toEqual([{ text: 'a case', hit: false }])

    // Overlapping at the same start, overlapping mid-run, and adjacent — three ways two ranges become
    // one mark, and the one that is NOT a merge beside them.
    expect(marked('reduce', ['re', 'red'])).toEqual([
        { text: 'red', hit: true },
        { text: 'uce', hit: false },
    ])
    expect(marked('abcd', ['ab', 'bc'])).toEqual([
        { text: 'abc', hit: true },
        { text: 'd', hit: false },
    ])
    expect(marked('abcd', ['ab', 'cd'])).toEqual([{ text: 'abcd', hit: true }])
    expect(marked('a-b-a', ['a'])).toEqual([
        { text: 'a', hit: true },
        { text: '-b-', hit: false },
        { text: 'a', hit: true },
    ])

    // Lowered on both sides: `terms` lowers the query, so a title in caps is matched and the MARK
    // carries the title's own casing rather than the query's.
    expect(marked('A Case', terms('CASE'))).toEqual([
        { text: 'A ', hit: false },
        { text: 'Case', hit: true },
    ])
})

test('/demos frames every app in the fleet, and says so when one is not there', async () => {
    // The page and `fleet.ts` read ONE list, and this is what says so. A prefix written in two places
    // is a demo served at one address and shown at another — which renders as an empty box rather
    // than as anything a reader could diagnose.
    //
    // BOTH STATES, and the component directly rather than the page: whether a demo is up is a live
    // fact about another process, so the page asks an rpc and under `bun test` the honest answer is
    // always "no". Rendering `Demo` with the answer supplied is what lets the up state be asserted at
    // all — and the down state matters just as much, because it is the one a reader meets first.
    for (const app of APPS) {
        const up = await renderToString(component(Demo, { app, up: true }))
        expect(up, `${app.name} has no frame`).toContain(`src="${app.prefix}${app.entry}"`)
        expect(up, `${app.name} is not named`).toContain(app.title)

        const down = await renderToString(component(Demo, { app, up: false }))
        expect(down, `${app.name} frames a demo that is not running`).not.toContain('<iframe')
        // The PORT, because "not running" without it does not tell anybody what to go and start.
        expect(down, `${app.name} does not say what is missing`).toContain(String(app.port))
        expect(down, `${app.name} does not say how to serve it`).toContain('bun run fleet')
    }

    // Every prefix is distinct, because the door forwards by longest match: two apps sharing one
    // would send both to whichever sorted first, and the second would never be reachable at all.
    const prefixes = new Set(APPS.map((app) => app.prefix))
    expect(prefixes.size, 'two demo apps claim the same prefix').toBe(APPS.length)
})
