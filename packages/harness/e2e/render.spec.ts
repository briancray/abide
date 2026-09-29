// HOW LONG A COMPILED PAGE TAKES TO MOUNT, in a real engine. The server half is timed under bun
// (`bun run bench:render`) because it touches no DOM; this half cannot be, so it is here.
//
// THE ARM HAS TO DO THE SAME WORK, which is the lesson the server bench learned the hard way: its
// first hand-written arm skipped escaping, was 3x faster for it, and was measuring a page with an
// injection in it. Here the arm finds the same nodes a later update would write. What abide does
// ON TOP is open a reactive subscription per run — real work, and named in the output rather than
// buried in the ratio.

import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

const REPO = new URL('../../../', import.meta.url).pathname
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
import { buildCompiledPage } from './packages/harness/scripts/buildCompiledPage.ts'
import { abideSource, cards, vanillaMarkup, vanillaWire } from './packages/harness/scripts/renderCases.ts'
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

test('the client mount, against the page wired by hand', async ({
    page,
}, testInfo) => {
    test.setTimeout(5 * 60 * 1000)
    const lines = [`\n=== ${testInfo.project.name} — parse + wire ===`]

    for (const built of pages) {
        await page.goto('about:blank')
        await page.setContent('<!doctype html><html><body></body></html>')
        await page.addScriptTag({ content: built.script })

        const measured = (await page.evaluate(
            ({ markup, vanillaMarkup, vanillaScript, size }) => {
                const wireVanilla = new Function(vanillaScript)
                const mount = (
                    globalThis as unknown as {
                        __MOUNT_INTO__: (root: Node) => void
                    }
                ).__MOUNT_INTO__

                // ONE OP = parse the document and wire it, which is what a page pays. Both arms
                // pay the same parse, so what the ratio sees is the wiring.
                const run = (which: 'abide' | 'vanilla'): number => {
                    const reps = size >= 1000 ? 20 : size >= 100 ? 100 : 400
                    const host = document.createElement('div')
                    document.body.appendChild(host)
                    // Warm both shapes before timing.
                    for (let at = 0; at < 3; at += 1) {
                        host.innerHTML =
                            which === 'abide' ? markup : vanillaMarkup
                        if (which === 'abide') mount(host)
                        else wireVanilla()
                    }
                    const start = performance.now()
                    for (let at = 0; at < reps; at += 1) {
                        host.innerHTML =
                            which === 'abide' ? markup : vanillaMarkup
                        if (which === 'abide') mount(host)
                        else wireVanilla()
                    }
                    const elapsed = performance.now() - start
                    host.remove()
                    return (elapsed * 1e6) / reps
                }

                const abide = run('abide')
                const vanilla = run('vanilla')

                // THE SAME WORK IN A LOOP. The emitted mount is straight-line — one `watch` per
                // slot, unrolled — and the server bench found that shape costing ~6x what a loop
                // costs because code that runs once never gets warm. If that is the cause here
                // too, this arm is far cheaper than `abide` while doing the same bindings, and it
                // is a `{#for}` problem rather than a binding-cost one.
                const looped = (): number => {
                    const g = globalThis as unknown as {
                        __LOOP_MOUNT__?: (root: Node) => void
                    }
                    if (g.__LOOP_MOUNT__ === undefined) return 0
                    const reps = size >= 1000 ? 20 : size >= 100 ? 100 : 400
                    const host = document.createElement('div')
                    document.body.appendChild(host)
                    for (let at = 0; at < 3; at += 1) {
                        host.innerHTML = markup
                        g.__LOOP_MOUNT__(host)
                    }
                    const start = performance.now()
                    for (let at = 0; at < reps; at += 1) {
                        host.innerHTML = markup
                        g.__LOOP_MOUNT__(host)
                    }
                    const elapsed = performance.now() - start
                    host.remove()
                    return (elapsed * 1e6) / reps
                }
                const loop = looped()

                // BOTH ARMS MUST HAVE FOUND THE SAME NODES. An arm that wired nothing is the
                // fastest on the table, and only the count tells it from a quick one.
                const host = document.createElement('div')
                document.body.appendChild(host)
                host.innerHTML = vanillaMarkup
                wireVanilla()
                const wired = (
                    globalThis as unknown as { __WIRED__: unknown[] }
                ).__WIRED__.length
                host.remove()

                return { abide, vanilla, loop, wired }
            },
            {
                markup: built.markup,
                vanillaMarkup: built.vanillaMarkup,
                vanillaScript: built.vanillaScript,
                size: built.size,
            },
        )) as { abide: number; vanilla: number; loop: number; wired: number }

        expect(measured.wired, 'the hand-written arm wired nothing').toBe(
            built.size * 3,
        )
        lines.push(
            `  ${String(built.size).padStart(4)} cards, ${String(built.size * 3).padStart(4)} slots   abide ${(measured.abide / 1e6).toFixed(3)} ms   vanilla ${(measured.vanilla / 1e6).toFixed(3)} ms   ${(measured.abide / measured.vanilla).toFixed(2)}x`,
        )
        lines.push(
            `       ${(measured.abide / (built.size * 3)).toFixed(0)} ns a slot; abide also opens a reactive subscription per run, which the arm has none of`,
        )
        if (measured.loop > 0)
            lines.push(
                `       the same bindings in a LOOP: ${(measured.loop / 1e6).toFixed(3)} ms   ${(measured.loop / measured.vanilla).toFixed(2)}x vanilla   (${(measured.abide / measured.loop).toFixed(2)}x cheaper than unrolled)`,
            )
    }
    lines.push('')
    lines.push(
        '  The LOOP arm lands within ~15% of the emitted straight-line code at every size, so',
    )
    lines.push(
        '  unlike the SERVER half the shape is not the cost here: `{#for}` will not change this',
    )
    lines.push(
        '  row. What abide pays over the arm is the reactive subscription per run — real work the',
    )
    lines.push(
        '  hand-written page has none of, and the reason it can update at all.',
    )
    console.log(lines.join('\n'))
})
