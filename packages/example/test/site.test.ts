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
import { renderToString } from 'abide/server'
import { allSuites } from '../demos/index.ts'
import { NAV } from '../demos/SUITES.ts'
import Cases from '../site/cases.abide'
import { type Face, painted, scan, sliceOf } from '../site/code.ts'

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
        expect(markup).not.toContain('passing')
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
    for (const href of ['/docs/state', '/tests', '/bench']) {
        expect(sections, `the nav names ${href}`).toContain(`href="${href}"`)
    }
    for (const entry of NAV) {
        expect(sections, `the nav does not name ${entry.name} itself`).not.toContain(`href="/${entry.name}"`)
    }

    // And inside a capability, the other two views of it — which is the claim that makes three routes per
    // capability navigable rather than merely reachable.
    const inside = await navAt('/docs/memo')
    expect(inside).toContain('href="/tests/memo"')
    expect(inside).toContain('href="/bench/memo"')
    // Not a link to the page you are already on.
    expect(inside).not.toContain('href="/docs/memo"')

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
            for (const face of ['run', 'interact'] as Face[]) {
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
