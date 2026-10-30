// 32.70 IN AN ENGINE: an `xlink:href` the client writes on an SVG element it builds is in XLink's
// namespace, as the parser's is (`addAttribute`). `bun test` cannot say so — its emulated DOM puts
// one `setAttribute` makes there too, where an engine gives it none and the `<use>` names nothing —
// which is why this is a browser spec. Both writers: the build's, for a static value, and the
// binding's, for a live one it creates on the mount.
//
// THE REVERT: `addAttribute` writing through `setAttribute` alone. Both attributes then report no
// namespace (`null`).

import { execFileSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

const REPO = new URL('../../../', import.meta.url).pathname

const PAGE_SOURCE = `<script>
import { reactive } from '@abide/abide'
import Dot from './Dot.abide'

let rows = reactive([1])
</script>

<svg id="drawn">{#for r of rows}<Dot/>{/for}</svg>
<button id="grow" onclick={() => { rows = [...rows, 1] }}>grow</button>`

const DOT_SOURCE = `<script>
import { reactive } from '@abide/abide'

let target = reactive('#live')
</script>

<g><use xlink:href="#dot"/><use xlink:href={target}/></g>`

const compiled = JSON.parse(
    execFileSync(
        'bun',
        [
            '-e',
            `
import { buildCompiledPage } from './packages/abide/bench/buildCompiledPage.ts'
console.log(JSON.stringify(await buildCompiledPage(${JSON.stringify(PAGE_SOURCE)}, { Dot: ${JSON.stringify(DOT_SOURCE)} })))
`,
        ],
        { cwd: REPO, encoding: 'utf8' },
    )
        .trim()
        .split('\n')
        .pop() as string,
) as { markup: string; script: string }

test('an xlink attribute the client builds inside an svg is XLink’s — 32.70', async ({
    page,
}) => {
    await page.goto('about:blank')
    await page.setContent(
        `<!doctype html><html><body>${compiled.markup}</body></html>`,
    )
    await page.addScriptTag({ content: compiled.script })
    await page.evaluate(() => {
        ;(globalThis as unknown as { __MOUNT__: () => void }).__MOUNT__()
    })
    await page.click('#grow')
    const spaces = await page.evaluate(() => {
        const rows = document.querySelectorAll('#drawn > g')
        const spaces: (string | null)[] = []
        for (const use of rows[rows.length - 1]?.querySelectorAll('use') ??
            []) {
            const written = use.getAttributeNode('xlink:href')
            spaces.push(written === null ? '(missing)' : written.namespaceURI)
        }
        return { rows: rows.length, spaces }
    })
    expect(spaces).toEqual({
        rows: 2,
        spaces: [
            'http://www.w3.org/1999/xlink',
            'http://www.w3.org/1999/xlink',
        ],
    })
})
