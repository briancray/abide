// HOW LONG A COMPILED PAGE TAKES TO MOUNT, in a real engine. The server half is timed under bun
// (`bun run bench:render`) because it touches no DOM; this half cannot be, so it is here.
//
// THE ARM HAS TO DO THE SAME WORK, which is the lesson the server bench learned the hard way: its
// first hand-written arm skipped escaping, was 3x faster for it, and was measuring a page with an
// injection in it. Here the arm finds the same nodes a later update would write. What abide does
// ON TOP is open a reactive subscription per run — real work, and named in the output rather than
// buried in the ratio.

import { execFileSync } from 'node:child_process'
import type { Sample } from '@abide/harness/report'
import { expect, test } from '@playwright/test'
import { type Report, reportScript } from './reportScript.ts'

const REPO = new URL('../../../', import.meta.url).pathname
const REPORT = reportScript()
const SIZES = [10, 100, 1000]

type Built = {
    size: number
    markup: string
    script: string
    vanillaMarkup: string
    vanillaScript: string
}

const pages = JSON.parse(
    execFileSync(
        'bun',
        [
            '-e',
            `
import { buildCompiledPage } from './packages/abide/bench/buildCompiledPage.ts'
import { abideSource, cards, vanillaMarkup, vanillaWire } from './packages/abide/bench/renderCases.ts'
const out = []
for (const size of ${JSON.stringify(SIZES)}) {
    const list = cards(size)
    const page = await buildCompiledPage(abideSource(size).replace('CARDS', JSON.stringify(list)))
    out.push({ size, ...page, vanillaMarkup: vanillaMarkup(list), vanillaScript: vanillaWire() })
}
console.log(JSON.stringify(out))
`,
        ],
        { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    )
        .trim()
        .split('\n')
        .pop() as string,
) as Built[]

type Measured = {
    abide: number
    vanilla: number
    loop: number
    n: number
    floor: number
    abideClaim: string
    loopClaim: string
    // The emitted straight-line mount over the same bindings in a loop, as `ratio()` returned it.
    shape: { kind: string; claim: string }
    bound: number
    loopBound: number
    wired: number
    workDisagreement: string[]
}

// WEBKIT CANNOT PRICE THESE INSIDE A GATE: its clock is 1 ms, so 43.11's bar is 100 ms a sample
// and `batch()` refuses rather than report the clock. `list.spec.ts` carries the whole reason.
test.skip(
    ({ browserName }) => browserName === 'webkit',
    'webkit coarsens its clock to 1 ms; 43.11 cannot be met inside a gate budget',
)

test('the client mount, against the page wired by hand', async ({
    page,
}, testInfo) => {
    test.setTimeout(5 * 60 * 1000)
    const lines = [`\n=== ${testInfo.project.name} — parse + wire ===`]
    const shapes: { size: number; kind: string; claim: string }[] = []

    for (const built of pages) {
        await page.goto('about:blank')
        await page.setContent('<!doctype html><html><body></body></html>')
        await page.addScriptTag({ content: REPORT })
        await page.addScriptTag({ content: built.script })

        const measured = (await page.evaluate(
            ({ markup, vanillaMarkup, vanillaScript, size }) => {
                const { batch, claimOf, emulatedDom, ratio } = (
                    globalThis as unknown as { __REPORT__: Report }
                ).__REPORT__
                const wireVanilla = new Function(vanillaScript)
                const page = globalThis as unknown as {
                    __MOUNT_INTO__: (root: Node) => void
                    __LOOP_MOUNT__: (root: Node) => void
                    __FLUSH__: () => void
                    __WIRED__: unknown[]
                }
                const hostFor = (): HTMLElement => {
                    const host = document.createElement('div')
                    document.body.appendChild(host)
                    return host
                }

                // THE SAME WORK FROM EACH ARM, COUNTED BEFORE IT IS TIMED. An arm that wired
                // nothing is the fastest on the table, and only a count tells it from a quick
                // one. Every slot is blanked first, so a mount that never bound a slot leaves it
                // blank — `slotsBound` is the slots that came back.
                const bound = (
                    mount: (root: Node) => void,
                    exact: boolean,
                ): number => {
                    const host = hostFor()
                    host.innerHTML = markup
                    const nodes: Text[] = []
                    const values: string[] = []
                    for (const card of host.querySelectorAll('#list > article'))
                        for (let at = 0; at < 3; at += 1) {
                            const node = card.children[at]?.firstChild as Text
                            values.push(node.data)
                            node.data = ''
                            nodes.push(node)
                        }
                    mount(host)
                    page.__FLUSH__()
                    let count = 0
                    for (let at = 0; at < nodes.length; at += 1) {
                        const data = (nodes[at] as Text).data
                        if (exact ? data === values[at] : data !== '')
                            count += 1
                    }
                    host.remove()
                    return count
                }
                const abideBound = bound(page.__MOUNT_INTO__, true)
                // THE LOOP ARM WRITES ONE SPARE VALUE INTO EVERY SLOT, not the card's, so it is
                // held to a non-blank slot rather than to the right text.
                const loopBound = bound(page.__LOOP_MOUNT__, false)
                const wiredHost = hostFor()
                wiredHost.innerHTML = vanillaMarkup
                wireVanilla()
                const wired = page.__WIRED__.length
                wiredHost.remove()

                // ONE OP = parse the document and wire it, which is what a page pays. Both arms
                // pay the same parse, so what the ratio sees is the wiring.
                const vanillaHost = hostFor()
                const abideHost = hostFor()
                const loopHost = hostFor()
                const timed = batch({
                    case: `mount ${size} cards`,
                    arms: {
                        vanilla: () => {
                            vanillaHost.innerHTML = vanillaMarkup
                            wireVanilla()
                        },
                        abide: () => {
                            abideHost.innerHTML = markup
                            page.__MOUNT_INTO__(abideHost)
                        },
                        // THE SAME BINDINGS IN A LOOP. The emitted mount is straight-line — one
                        // `watch` per slot, unrolled — and the server bench found that shape far
                        // dearer than a loop because code that runs once never gets warm. This
                        // arm says whether the client pays the same.
                        loop: () => {
                            loopHost.innerHTML = markup
                            page.__LOOP_MOUNT__(loopHost)
                        },
                    },
                    emulated: emulatedDom(),
                    work: {
                        vanilla: { slotsBound: wired },
                        abide: { slotsBound: abideBound },
                        loop: { slotsBound: loopBound },
                    },
                    budgetNanoseconds: 20_000_000_000,
                })
                document.body.replaceChildren()
                const floor = { floor: timed.floor }
                const abide = timed.samples.abide as Sample
                const vanilla = timed.samples.vanilla as Sample
                const loop = timed.samples.loop as Sample
                const abideRatio = ratio(abide, vanilla, floor)
                const shape = ratio(abide, loop, floor)
                return {
                    abide: abide.nanoseconds,
                    vanilla: vanilla.nanoseconds,
                    loop: loop.nanoseconds,
                    n: timed.n,
                    floor: timed.floor,
                    abideClaim: claimOf(abideRatio),
                    loopClaim: claimOf(ratio(loop, vanilla, floor)),
                    shape: { kind: shape.kind, claim: claimOf(shape) },
                    bound: abideBound,
                    loopBound,
                    wired,
                    workDisagreement: abideRatio.workDisagreement,
                }
            },
            {
                markup: built.markup,
                vanillaMarkup: built.vanillaMarkup,
                vanillaScript: built.vanillaScript,
                size: built.size,
            },
        )) as Measured

        const slots = built.size * 3
        expect(measured.wired, 'the hand-written arm wired nothing').toBe(slots)
        // Reverted — the abide mount swapped for one that binds nothing — this read 0 of
        // 30 at 10 cards, and that arm is the fastest on the table.
        expect(measured.bound, 'the abide mount left slots unbound').toBe(slots)
        expect(measured.loopBound, 'the loop arm left slots unbound').toBe(
            slots,
        )
        shapes.push({ size: built.size, ...measured.shape })
        lines.push(
            `  ${String(built.size).padStart(4)} cards, ${String(slots).padStart(4)} slots   abide ${(measured.abide / 1e6).toFixed(3)} ms   vanilla ${(measured.vanilla / 1e6).toFixed(3)} ms   ${measured.abideClaim}   [n=${measured.n} floor=${(measured.floor * 100).toFixed(2)}%]`,
        )
        lines.push(
            `       ${(measured.abide / slots).toFixed(0)} ns a slot; abide also opens a reactive subscription per run, which the arm has none of`,
        )
        lines.push(
            `       the same bindings in a LOOP: ${(measured.loop / 1e6).toFixed(3)} ms   ${measured.loopClaim} vanilla   straight-line is ${measured.shape.claim} the loop`,
        )
        if (measured.workDisagreement.length > 0)
            lines.push(
                `       WORK DISAGREES — ${measured.workDisagreement.join('; ')}`,
            )
    }
    // WHAT THIS RUN SAYS about the shape, read off its verdicts rather than typed once: whether
    // the straight-line mount costs anything over the loop is the question `{#for}` answers on
    // the server, and this is where it is asked of the client.
    const level = shapes.filter((shape) => shape.kind !== 'ratio')
    const apart = shapes.filter((shape) => shape.kind === 'ratio')
    lines.push('')
    lines.push(
        apart.length === 0
            ? '  The straight-line mount is level with the loop at every size, so the shape is not the cost here.'
            : `  The straight-line mount is apart from the loop at ${apart.map((shape) => `${shape.size} cards (${shape.claim})`).join(', ')}${level.length === 0 ? '' : `, and level at ${level.map((shape) => shape.size).join(', ')}`}.`,
    )
    console.log(lines.join('\n'))
})
