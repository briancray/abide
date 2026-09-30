// WHAT A COMPONENT COSTS A ROW IN A BROWSER. `bun run bench:component` prices the server half —
// the render — and this is the other half a reader waits on: the mount, where the caller builds
// one accessor per prop per row (33.4) and the child mounts against its own anchors (32.17).
//
// THE ARMS ARE THE SAME CARD. The component's body is byte-identical to the inline row's, so the
// ratio is the invocation and nothing else. Both pages are built by `buildCompiledPage`, from one
// shell, for the reason that file already states: two arms differing in anything but the
// implementation are two implementations of different pages.

import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

const REPO = new URL('../../../', import.meta.url).pathname
const SIZES = [100, 1000]

type Arm = { script: string; markup: string }
type Built = { size: number; inline: Arm; nested: Arm }

const pages = JSON.parse(
    execFileSync(
        'bun',
        [
            '-e',
            `
import { buildCompiledPage } from './packages/harness/scripts/buildCompiledPage.ts'
import { abideCardSource, abideComponentSource, abideLoopSource, cards } from './packages/harness/scripts/renderCases.ts'
const out = []
for (const size of ${JSON.stringify(SIZES)}) {
    const list = cards(size)
    const flat = await buildCompiledPage(abideLoopSource().replace('CARDS', JSON.stringify(list)))
    const nested = await buildCompiledPage(
        abideComponentSource().replace('CARDS', JSON.stringify(list)),
        { Card: abideCardSource() },
    )
    out.push({ size, inline: flat, nested })
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

test('the mount of a list of components, against the same rows inline', async ({
    page,
}, testInfo) => {
    test.setTimeout(5 * 60 * 1000)
    const lines = [`\n=== ${testInfo.project.name} — a component per row ===`]

    // EACH ARM HYDRATES THE DOCUMENT ITS OWN SERVER WROTE, anchors and all: the component page's
    // markup carries a pair per row that the inline page's does not, and that difference is part
    // of what is being priced rather than something to equalise away.
    const measure = async (arm: Arm, size: number): Promise<number> => {
        await page.goto('about:blank')
        await page.setContent('<!doctype html><html><body></body></html>')
        await page.addScriptTag({
            content: `${arm.script}\nglobalThis.__MARKUP__ = ${JSON.stringify(arm.markup)};`,
        })
        return page.evaluate((rows) => {
            const mount = (
                globalThis as unknown as {
                    __MOUNT_INTO__: (root: Node) => void
                }
            ).__MOUNT_INTO__
            const markup = (globalThis as unknown as { __MARKUP__: string })
                .__MARKUP__
            const reps = rows >= 1000 ? 20 : 100
            const host = document.createElement('div')
            document.body.appendChild(host)
            for (let at = 0; at < 3; at += 1) {
                host.innerHTML = markup
                mount(host)
            }
            const start = performance.now()
            for (let at = 0; at < reps; at += 1) {
                host.innerHTML = markup
                mount(host)
            }
            const elapsed = performance.now() - start
            host.remove()
            return (elapsed * 1e6) / reps
        }, size)
    }

    for (const built of pages) {
        const inline = await measure(built.inline, built.size)
        const nested = await measure(built.nested, built.size)
        lines.push(
            `  ${String(built.size).padStart(4)} rows   inline ${(inline / 1000).toFixed(1)} µs   component ${(nested / 1000).toFixed(1)} µs   ${(nested / inline).toFixed(2)}x` +
                `\n              ${(inline / built.size).toFixed(0)} ns a row inline, ${(nested / built.size).toFixed(0)} ns a row as a component`,
        )
        expect(nested).toBeGreaterThan(0)
    }

    console.log(lines.join('\n'))
})
