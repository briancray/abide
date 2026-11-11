// THE BOTH-SUBSTRATES GATE. This lane's whole reason for existing is that one case
// counts the same under bun's DOM and in a real browser, and nothing about the DOM
// the case builds would move if that were false.
//
// It needs no served app — `page.setContent` is the page — which is why this project
// carries no `webServer`. The bun half is taken in a CHILD, by spawning bun on
// `bunSideCounts.ts`, rather than in this worker: it registers happy-dom over the
// process's globals, which every later spec in the worker would then run inside. And it
// is read off the same `CASES` rather than written out a second time: two transcriptions
// of one case agree by editing, not by construction.

import { expect, test } from '@playwright/test'

import { buildInjectable } from '../scripts/buildInjectable.ts'
import { CASES } from './CASES.ts'

/** The patch set and per-case counts under bun, read off `bunSideCounts.ts`. */
const underBun: {
    patchSet: string[]
    cases: Record<string, unknown>
} =
    await Bun.$`${process.execPath} ${new URL('../scripts/bunSideCounts.ts', import.meta.url).pathname}`.json()
const built = await buildInjectable()

test.beforeEach(async ({ page }) => {
    await page.addInitScript({ content: built })
    // A `setContent` on a page still sitting on its initial `about:blank` does not
    // rerun init scripts — nothing navigated — so every counter reads undefined and
    // the gate fails on the instrument rather than on the claim. The navigation is
    // what arms the injection.
    await page.goto('about:blank')
    await page.setContent('<!doctype html><html><body></body></html>')
})

// Asserted on the LIST, not on a count, because a count is what goes quietly to
// zero. A member one substrate does not have would otherwise be skipped in silence:
// happy-dom has no `Element.setHTMLUnsafe` and no `Document.writeln`, and both were
// in the first draft of the declaration.
test('the installed patch set is the same list in both substrates', async ({
    page,
}) => {
    const inChromium = await page.evaluate(() =>
        (
            globalThis as unknown as {
                __HARNESS_MEASURE__: { patchSet(): string[] }
            }
        ).__HARNESS_MEASURE__.patchSet(),
    )
    expect(inChromium).toEqual(underBun.patchSet)
})

// COUNT THE OUTERMOST PATCHED CALL ONLY, which is the rule the byte-identical patch
// set does not supply. Measured: `textContent = ''` on a node with two children
// reports 2 `removeChild` calls under happy-dom and 0 under Chromium. Drop the
// re-entrancy guard and one write counts as three things under bun and one in a
// browser — the lists above stay identical and the counts diverge. Reverted, bun
// reports 4 element moves on the first case and chromium 2.
for (const name of Object.keys(CASES)) {
    test(`"${name}" counts identically in both substrates`, async ({
        page,
    }) => {
        const source = (CASES[name] as () => void).toString()
        const inChromium = await page.evaluate((body: string) => {
            const rebuilt = new Function(`return (${body})`)() as () => void
            return (
                globalThis as unknown as {
                    __HARNESS_MEASURE__: {
                        measure(run: () => void): Record<string, number | null>
                    }
                }
            ).__HARNESS_MEASURE__.measure(rebuilt)
        }, source)
        expect(inChromium).toEqual(underBun.cases[name] as object)
    })
}
