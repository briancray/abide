// THE COMPILED PAGE, PRICED IN THE ENGINES A READER ACTUALLY BRINGS, against the page somebody
// would have written by hand.
//
// Everything else the compiler has is counted under bun, where the DOM is an emulator — and
// CLAUDE.md is explicit that absolute numbers from one describe the emulator. What TRANSFERS is
// the count of DOM calls, which is why `harness/measure` is the only lane that runs in both. This
// spec is that lane in Chromium (V8) and WebKit (JSC).
//
// It REPORTS the counts and ASSERTS only the invariant a wrong implementation breaks: the
// compiled page must not create or move nodes to change a number. A threshold on ms here would be
// a threshold on somebody else's machine under somebody else's load.

import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

const REPO = new URL('../../../', import.meta.url).pathname

const PAGE_SOURCE = `<script>
import { reactive } from '@abide/abide'

let count = reactive(0)
const label = 'clicks'
</script>

<p id="out">{label}: {count}</p>
<button id="go" onclick={() => count = count + 1}>more</button>`

// The hand-written arm: the page somebody writes when nothing is compiling for them. It reaches
// for `textContent`, which is what a person reaches for — and that is the comparison, not a
// straw man and not an expert's version of it.
const VANILLA_MARKUP = '<p id="out">clicks: 0</p><button id="go">more</button>'
const VANILLA_SCRIPT = `
let n = 0
const out = document.querySelector('#out')
document.querySelector('#go').addEventListener('click', () => {
    n += 1
    out.textContent = 'clicks: ' + n
})
`

const measureLane = execFileSync(
    'bun',
    ['packages/harness/scripts/buildInjectable.ts'],
    { cwd: REPO, encoding: 'utf8' },
).trim()

const compiled = JSON.parse(
    execFileSync(
        'bun',
        [
            '-e',
            `
import { buildCompiledPage } from './packages/harness/scripts/buildCompiledPage.ts'
console.log(JSON.stringify(await buildCompiledPage(${JSON.stringify(PAGE_SOURCE)})))
`,
        ],
        { cwd: REPO, encoding: 'utf8' },
    )
        .trim()
        .split('\n')
        .pop() as string,
) as { markup: string; script: string }

type Counts = Record<string, number | null>

test('the compiled page against the hand-written one, in this engine', async ({
    page,
}, testInfo) => {
    // The init script is re-run on every navigation, and `run` navigates once per arm — which is
    // also what stops the two arms from sharing a JavaScript context.
    await page.addInitScript({ path: measureLane })

    // A FRESH NAVIGATION PER ARM. `setContent` replaces the document but KEEPS the JavaScript
    // context, so `__MOUNT__` defined by the compiled arm was still on the global when the
    // hand-written page loaded — and mounting abide into a page with no markers threw inside the
    // VANILLA arm, where nothing about the failure pointed at the spec.
    async function run(
        markup: string,
        script: string,
    ): Promise<{ counts: Counts; text: string }> {
        await page.goto('about:blank')
        await page.setContent(
            `<!doctype html><html><body>${markup}</body></html>`,
        )
        await page.addScriptTag({ content: script })
        return (await page.evaluate(() => {
            const lane = globalThis as unknown as {
                __HARNESS_MEASURE__: { measure(body: () => void): Counts }
                __MOUNT__?: () => void
                __FLUSH__?: () => void
            }
            lane.__MOUNT__?.()
            // THE TURN ENDS INSIDE THE MEASUREMENT. A reactive drain is batched to the end of
            // one, so a body that clicks and returns is read before any binding has run — and
            // reports a page doing NO work as a page doing less of it. The hand-written arm has
            // nothing to flush, which is itself part of what is being compared.
            const counts = lane.__HARNESS_MEASURE__.measure(() => {
                ;(document.querySelector('#go') as HTMLElement).click()
                lane.__FLUSH__?.()
            })
            // WHAT THE PAGE ACTUALLY SAYS AFTERWARDS, returned beside the counts and never
            // inferred from them. An arm that does no work reports the best numbers on the
            // table, and the only thing that tells it apart from a fast one is the output.
            return {
                counts,
                text:
                    (document.querySelector('#out') as HTMLElement)
                        .textContent ?? '',
            }
        })) as { counts: Counts; text: string }
    }

    const abide = await run(compiled.markup, compiled.script)
    const vanilla = await run(VANILLA_MARKUP, VANILLA_SCRIPT)

    // BEFORE ANY COUNT IS READ. Both arms must have done the job, or the cheaper one is only
    // cheaper because it did nothing — which is the failure CLAUDE.md records twice.
    expect(abide.text, 'the compiled page did not update').toBe('clicks: 1')
    expect(vanilla.text, 'the hand-written page did not update').toBe(
        'clicks: 1',
    )

    const fields = [
        'nodesCreated',
        'elementsMoved',
        'textMoved',
        'dataWrites',
        'redundantDataWrites',
    ]
    const lines = [`\n=== ${testInfo.project.name} — one click ===`]
    for (const field of fields)
        lines.push(
            `  ${field.padEnd(22)} abide ${String(abide.counts[field]).padStart(4)}   vanilla ${String(vanilla.counts[field]).padStart(4)}`,
        )
    console.log(lines.join('\n'))

    // THE ONE ASSERTION. A compiled page changes a number by writing the text node it already
    // knows about; it does not create one and does not move one. THE REVERT: emit a binding that
    // sets `innerHTML` on the slot's parent, and this reports nodesCreated 0 -> 3 in every engine
    // while the page still reads `clicks: 1`.
    expect(abide.counts.nodesCreated).toBe(0)
    expect(abide.counts.elementsMoved).toBe(0)
    expect(abide.counts.textMoved).toBe(0)
})
