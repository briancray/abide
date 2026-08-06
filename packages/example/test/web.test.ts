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

import { page } from '../web/page.ts'

describe('web pages', () => {
    for (const suite of SUITES) {
        test(`/${suite.name} builds`, async () => {
            page(suite)
            const main = document.querySelector('main')
            expect(main).not.toBeNull()
            // One card per case, and the nav reaches every other page.
            expect(main?.querySelectorAll('section').length).toBe(suite.cases.length)
            expect(document.querySelectorAll('header a').length).toBe(NAV.length + 1)
            expect(document.title).toBe(`${suite.title} — abide`)
            // The cards start their cases on load; let the assertions land before the next page
            // replaces the document out from under them.
            await new Promise((resolve) => setTimeout(resolve, 50))
        })
    }

    test('/bench assembles every benched case', async () => {
        const { benched } = await import('../demos/index.ts')
        const expected = (await benched()).length
        await import('../web/bench.ts') // builds the whole page at module scope
        expect(document.querySelectorAll('main section').length).toBe(expected)
        expect(expected).toBeGreaterThan(0)
    })
})
