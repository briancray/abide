// 55.1 IN A REAL BROWSER, against `abide start`: a page calling a worker file's exports runs them in
// a Web Worker started from the thread's entry the build wrote beside the page's chunks — a call and
// a stream alike, their answers painted where the test reads them.
//
// THE REVERT: drop `workerFilesPlugin` from the pages' build in `clientBundle.ts`; the page bundles
// the file itself, and `#said` reads `page` rather than `thread`.

import { expect, test } from '@playwright/test'
import type { Subprocess } from 'bun'

import { servedFixture } from './servedFixture.ts'

// ONE TREE AND ONE WORKER PER PROJECT, for `routing.spec.ts`'s reason.
test.describe.configure({ mode: 'default' })

const THREAD = `// Where it ran, and a count streamed from there.
export async function where(): Promise<string> {
    return typeof window === 'undefined' ? 'thread' : 'page'
}

export async function* countTo(last: number): AsyncGenerator<number> {
    for (let at = 1; at <= last; at += 1) yield at
}
`

const PAGE = `<script>
import { reactive } from '@abide/abide'
import { countTo, where } from '#src/lib/thread.worker.ts'

let said = reactive('')

async function ask() {
    const counted: number[] = []
    for await (const at of countTo(3)) counted.push(at)
    said = \`\${await where()} \${counted.join(',')}\`
}
</script>

<main>
<button id="ask" onclick={ask}>ask</button>
<p id="said">{said}</p>
</main>`

let server: Subprocess | undefined
let base = ''

test.beforeAll(async ({}, testInfo) => {
    ;({ base, server } = await servedFixture(
        `e2e-worker-${testInfo.project.name}`,
        {
            'lib/thread.worker.ts': THREAD,
            'index.abide': PAGE,
        },
    ))
})

test.afterAll(() => {
    server?.kill()
})

test("a page's call to a worker file runs in a thread of its own — 55.1, 55.5", async ({
    page,
}) => {
    await page.goto(`${base}/`)
    const said = page.locator('#said')
    // Pressed until heard: a press before hydration lands on markup with no handler.
    for (
        let tries = 0;
        tries < 100 && (await said.textContent()) === '';
        tries += 1
    ) {
        await page.click('#ask')
        await page.waitForTimeout(50)
    }
    await expect(said).toHaveText(/^thread 1,2,3$/)
})
