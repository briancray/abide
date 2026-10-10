// 11.29 ON BOTH SIDES — a handler's parameter defaults key its call the same on the server that
// renders a page and over the wire the browser calls it on. What is counted is how many times the
// handler RAN: a call answered from the render's run and one answered by a run of its own carry
// the same page, and only the count tells them apart (41.13).

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const PAGES = `import { GET } from '@abide/abide/server'

let runs = 0

export const list = GET(async ({ page = 1 }: { page?: number }) => {
    runs += 1
    const run = runs
    await new Promise((done) => setTimeout(done, 150))
    return { page, run }
})
`

// One page leaves the member to the default and the other writes it.
const pageCalling = (args: string): string => `<script>
import { reactive } from '@abide/abide'
import { list } from '#server/rpc/pages.ts'

const shown = reactive(() => list(${args}))
</script>

<main><p>{shown().page}</p></main>`

let stop = (): void => {}
let base = ''

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'ui/pages/page.abide': pageCalling('{}'),
        'ui/pages/written/page.abide': pageCalling('{ page: 1 }'),
        'server/rpc/pages.ts': PAGES,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

const ADDRESS = '/__abide/rpc/pages/list'

async function call(query: string, cookie?: string): Promise<number> {
    const answer = await Bun.fetch(`${base}${ADDRESS}${query}`, {
        headers: cookie === undefined ? {} : { cookie },
    })
    return ((await answer.json()) as { run: number }).run
}

async function render(path: string): Promise<{ cookie: string; html: string }> {
    const page = await Bun.fetch(`${base}${path}`)
    return {
        html: await page.text(),
        cookie: (page.headers.get('set-cookie') ?? '').split(';')[0] as string,
    }
}

// A RENDER THAT LEFT `page` TO THE DEFAULT is answered to the browser's call that wrote it — which is
// the call the browser's copy makes, its early call in the head included. THE REVERT: drop
// `normalised` from `call` in `rpc.ts`; the render's run is filed under `{}`, the head starts
// `list` with no query, and the call is answered by a run of its own — 2 past the anchor where 1 is
// due.
test("a render's call leaving a member to the default answers the browser's call writing it — 11.29", async () => {
    const anchor = await call('?page=1')
    const { cookie, html } = await render('/')
    expect(await call('?page=1', cookie)).toBe(anchor + 1)
    expect(html).toContain(`${ADDRESS}?page=1`)
})

// AND THE OTHER WAY: a call arriving with no args is keyed by the defaults before its seed is looked
// up. THE REVERT: drop `normalised` after `coerceArgs` in `answerRpc`; the call is looked up under
// no args and runs again — 2 past the anchor where 1 is due.
test('a call arriving with no args is answered from a render that wrote the default — 11.27', async () => {
    const anchor = await call('?page=1')
    const { cookie } = await render('/written')
    expect(await call('', cookie)).toBe(anchor + 1)
})
