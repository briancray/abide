// WHAT A KEYED REORDER COSTS, in a real engine, against the fewest DOM calls the edit
// needs and against the version written the obvious way.
//
// This is the conversion CLAUDE.md asks for and the repo did not have. The rule —
// "a full reverse cannot tell a minimal keyed reconcile from a rebuild; a two-row swap
// can" — was carried by `list.test.ts`, which counts nodes moved, and by `bench:grid`,
// which deliberately has no clock. A COUNT IS NOT A COST: moving a comment is 0.11 µs
// and moving an element with its subtree is 2.8 µs, because only one of them is in the
// reflow. So the count says which implementation is doing less and only a real engine
// says whether that is worth anything.
//
// BROWSER-ONLY, and that is not a limitation. `batch()` refuses a duration whose op
// touched an emulated DOM, so there is no bun-side arm to add — a reorder in happy-dom
// would describe happy-dom.
//
// It reports rather than asserts, like `reactive.spec.ts`: a threshold here is a
// threshold on somebody else's machine under somebody else's load. What it is for is
// the SIGN and the ORDER of the two ratios, and whether the relocation case stays a
// relocation.

import { execFileSync } from 'node:child_process'
import { test } from '@playwright/test'

const REPO = new URL('../../../', import.meta.url).pathname

type Row = {
    case: string
    distinguishes: string
    abide: number
    vanilla: number
    careless: number
    costClaim: string
    buysClaim: string
    n: number
    floor: number
    substrate: string
}

const built = execFileSync(
    'bun',
    ['packages/harness/scripts/buildBench.ts', 'list'],
    { cwd: REPO, encoding: 'utf8' },
)
    .trim()
    .split('\n')
    .pop() as string

// WEBKIT CANNOT PRICE THESE INSIDE A GATE, and the refusal that says so is the
// instrument working rather than a fault to route around. 44.12 asks a sample to be 100x
// the clock's MEASURED resolution; webkit reports 1,000,000 ns where chromium is ~100 µs
// and bun is 41 ns, so the bar is 100 ms a sample. Growing n to clear it runs to `MAX_N`,
// and ten reps of that measured ~28 s for ONE case — twenty cases is nine minutes, on a
// gate that otherwise finishes in two.
//
// SO THE NUMBER IS NOT LOST, IT IS MOVED. This lane answers in the engines whose clock
// can carry it inside a gate; a webkit reading is a `bun run bench` question, taken
// deliberately and with a budget to match. Reported as a skip rather than a failure
// because nothing here is broken — the engine's clock is the substrate, and 44.18's
// whole point is that an instrument says when it cannot price something.
test.skip(
    ({ browserName }) => browserName === 'webkit',
    'webkit coarsens its clock to 1 ms; 44.12 cannot be met inside a gate budget',
)

test('a keyed reorder against the DOM-call floor and against a rebuild', async ({
    page,
}, testInfo) => {
    // Four cases, three arms each, batched against a ~100 µs clock over 200-row lists.
    test.setTimeout(15 * 60 * 1000)
    await page.addInitScript({ path: built })
    // `setContent` on a page still on its initial `about:blank` re-runs no init script
    // — nothing navigated — so the injection would be silently absent.
    await page.goto('about:blank')
    await page.setContent('<!doctype html><html><body></body></html>')

    const rows = (await page.evaluate(() =>
        (
            globalThis as unknown as { __LIST_BENCH__: () => Row[] }
        ).__LIST_BENCH__(),
    )) as Row[]

    const lines = [`\n=== ${testInfo.project.name} ===`]
    for (const row of rows) {
        lines.push(
            `${row.case}\n  distinguishes: ${row.distinguishes}\n` +
                `  abide ${(row.abide / 1000).toFixed(2)} µs   floor ${(row.vanilla / 1000).toFixed(2)} µs   rebuild ${(row.careless / 1000).toFixed(2)} µs\n` +
                `  costs ${row.costClaim} the DOM-call floor   buys ${row.buysClaim} a rebuild   [n=${row.n} floor=${(row.floor * 100).toFixed(2)}% ${row.substrate}]`,
        )
    }
    console.log(lines.join('\n'))
})
