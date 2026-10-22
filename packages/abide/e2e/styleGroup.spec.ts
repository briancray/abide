// 32.71 IN AN ENGINE: a `style={expr}` beside a `style:prop` is parsed by the browser's own CSSOM
// (`setStyleGroup`), so a `;` inside a string is not a separator. `bun test` cannot say so — its
// emulated DOM splits a declaration list on every `;` — which is why this is a browser spec.
//
// THE REVERT: split the attribute's text on `;` by hand in `declarationsOf`. The font family then
// reads `a` where `"a;b"` is due.

import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

const REPO = new URL('../../../', import.meta.url).pathname

const PAGE_SOURCE = `<script>
import { reactive } from '@abide/abide'

let look = reactive('color: red')
let wide = reactive('10px')
</script>

<p id="out" style={look} style:width={wide}>x</p>
<button id="quoted" onclick={() => { look = 'font-family: "a;b"; color: blue' }}>quoted</button>`

const compiled = JSON.parse(
    execFileSync(
        'bun',
        [
            '-e',
            `
import { buildCompiledPage } from './packages/abide/bench/buildCompiledPage.ts'
console.log(JSON.stringify(await buildCompiledPage(${JSON.stringify(PAGE_SOURCE)})))
`,
        ],
        { cwd: REPO, encoding: 'utf8' },
    )
        .trim()
        .split('\n')
        .pop() as string,
) as { markup: string; script: string }

test('a style group parses its attribute as the browser does — 32.71', async ({
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
    await page.click('#quoted')
    const style = await page.evaluate(() => {
        const out = (document.querySelector('#out') as HTMLElement).style
        return {
            fontFamily: out.fontFamily,
            color: out.color,
            width: out.width,
        }
    })
    expect(style).toEqual({ fontFamily: '"a;b"', color: 'blue', width: '10px' })
})
