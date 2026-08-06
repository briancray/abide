// The page renderers, rendered.
//
// `bun test` cannot click a button, but it can prove that every page still BUILDS: that the shell,
// the nav, one card per case and the whole bench assembly evaluate without throwing. That is the
// half of the browser pages a demo-as-test does not already cover, and it is the half that breaks
// silently — a page that throws on load still returns 200.

import { describe, expect, test } from 'bun:test'
import { allSuites } from '../demos/index.ts'
import { NAV } from '../demos/SUITES.ts'

const SUITES = await allSuites()

import { highlight, page } from '../web/page.ts'

describe('web pages', () => {
    for (const suite of SUITES) {
        test(`/${suite.name} builds`, async () => {
            const ran = page(suite)
            const main = document.querySelector('main')
            expect(main).not.toBeNull()
            // One card per case, and the nav reaches every other page.
            expect(main?.querySelectorAll('section').length).toBe(suite.cases.length)
            expect(document.querySelectorAll('header a').length).toBe(NAV.length + 1)
            expect(document.title).toBe(`${suite.title} — abide`)
            // The cards run their cases one after another; wait for the last of them before the next
            // page replaces the document out from under it.
            await ran
        })
    }

    // The colourer's failure mode is silent: a scanner that mis-reads a regex or a nested `${}` drops
    // or repeats characters, and the card then shows code nobody wrote. Colour is a matter of taste;
    // every other character surviving in order is not.
    //
    // Leading whitespace is the one thing the pane rewrites — see `outdent` — so it is the one thing
    // this cannot compare. Line COUNT still has to match: an outdent that ate a newline would pass a
    // per-character check and ruin the pane.
    test('colouring a case body loses nothing but leading whitespace', () => {
        const bare = (text: string): string => text.replace(/^[ \t]+/gm, '')
        let bodies = 0
        for (const suite of SUITES) {
            for (const spec of suite.cases) {
                for (const fn of [spec.run, spec.interact, spec.bench]) {
                    if (fn === undefined) continue
                    const code = fn.toString()
                    const host = document.createElement('pre')
                    host.append(highlight(code))
                    const shown = host.textContent ?? ''
                    expect(bare(shown)).toBe(bare(code))
                    expect(shown.split('\n').length).toBe(code.split('\n').length)
                    // Only ever pulled left, never pushed right.
                    expect(shown.length).toBeLessThanOrEqual(code.length)
                    bodies++
                }
            }
        }
        expect(bodies).toBeGreaterThan(0)
    })

    test('/bench assembles every benched case', async () => {
        const { benched } = await import('../demos/index.ts')
        const expected = (await benched()).length
        await import('../web/bench.ts') // builds the whole page at module scope
        expect(document.querySelectorAll('main section').length).toBe(expected)
        expect(expected).toBeGreaterThan(0)
    })
})
