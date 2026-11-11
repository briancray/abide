// 16.93 IN A REAL BROWSER, against `abide start`: a page reading K streaming `GET`s holds no http
// connection while they stream — they are read over the socket mux the page already holds — so the
// page reaches `networkidle` with every stream still flowing. Only a browser counts its own
// connections, and only a real one holds ~6 of them per origin, which is the cost being removed.

import { expect, test } from '@playwright/test'
import type { Subprocess } from 'bun'

import { servedFixture } from './servedFixture.ts'

test.describe.configure({ mode: 'default' })

const STREAMS = 3

const TICKS = `import { GET } from '@abide/abide/server'

export default GET(async function* ({ n }: { n: string }) {
    for (let at = 0; at < 600; at++) {
        yield { n, at }
        await Bun.sleep(50)
    }
})
`

const PAGE = `<script>
import { reactive } from '@abide/abide'
import ticks from '#src/data/ticks.handler.ts'

const a = reactive(() => ticks({ n: 'a' }))
const b = reactive(() => ticks({ n: 'b' }))
const c = reactive(() => ticks({ n: 'c' }))
</script>

<main>
    <p id="a">{a.ready() ? a().length : 0}</p>
    <p id="b">{b.ready() ? b().length : 0}</p>
    <p id="c">{c.ready() ? c().length : 0}</p>
</main>`

let server: Subprocess | undefined
let base = ''

test.beforeAll(async ({}, testInfo) => {
    ;({ base, server } = await servedFixture(
        `e2e-stream-mux-${testInfo.project.name}`,
        { 'data/ticks.handler.ts': TICKS, 'streams/index.abide': PAGE },
    ))
})

test.afterAll(() => {
    server?.kill()
})

// THE GATE: once every stream is flowing, the fetches the page holds open. THE REVERT: read every
// stream with `answerOf` in `wire`'s `streamed` (skip `streamOverMux`); 3 are open where 0 are due,
// and `networkidle` never comes.
test(`a page reading ${STREAMS} streams holds no http connection while they stream — 16.93`, async ({
    page,
}) => {
    const open = new Set<unknown>()
    page.on('request', (request) => {
        const kind = request.resourceType()
        if (kind === 'fetch' || kind === 'xhr') open.add(request)
    })
    page.on('requestfinished', (request) => open.delete(request))
    page.on('requestfailed', (request) => open.delete(request))
    await page.goto(`${base}/streams`)
    // Flowing: each has landed several chunks since the page set up, and has hundreds to go.
    for (const id of ['#a', '#b', '#c'])
        await expect
            .poll(async () => Number(await page.textContent(id)), {
                timeout: 10_000,
            })
            .toBeGreaterThan(5)
    expect(open.size).toBe(0)
    await page.waitForLoadState('networkidle', { timeout: 5_000 })
    // Still flowing past the idle.
    const before = Number(await page.textContent('#a'))
    await expect
        .poll(async () => Number(await page.textContent('#a')))
        .toBeGreaterThan(before)
})
