// THE BOTH-SUBSTRATES GATE. This lane's whole reason for existing is that one case
// counts the same under bun's DOM and in a real browser, and nothing about the DOM
// the case builds would move if that were false.
//
// It needs no served app — `page.setContent` is the page — which is why this project
// carries no `webServer`. Playwright runs on node and cannot import a lane, so the
// bun half is taken by spawning bun on `bunSideCounts.ts` rather than by writing the
// expectations out a second time: two transcriptions of one case agree by editing,
// not by construction.

import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { CASES } from './CASES.ts'

const REPO = new URL('../../../', import.meta.url).pathname

function bunSide(): {
    patchSet: string[]
    cases: Record<string, Record<string, number | null>>
} {
    return JSON.parse(
        execFileSync('bun', ['packages/harness/scripts/bunSideCounts.ts'], {
            cwd: REPO,
            encoding: 'utf8',
        }),
    )
}

function injectable(): string {
    return execFileSync(
        'bun',
        ['packages/harness/scripts/buildInjectable.ts'],
        { cwd: REPO, encoding: 'utf8' },
    ).trim()
}

const underBun = bunSide()
const built = injectable()

test.beforeEach(async ({ page }) => {
    await page.addInitScript({ path: built })
    // A `setContent` on a page still sitting on its initial `about:blank` does not
    // re-run init scripts — nothing navigated — so every counter reads undefined and
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
