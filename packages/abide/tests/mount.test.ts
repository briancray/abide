// 16.11, 36.11 — AN APP SERVED UNDER A SUB-PATH, set by `APP_URL` alone: the same build, every address
// resolved against the mount at run time (spawned, for `serve.test.ts`'s reason).

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const PAGE = `<script>
import { reactive, url } from 'abide'
import { getInvoice } from '#server/rpc/invoices.ts'

const invoice = reactive(() => getInvoice({ id: '4' }))
</script>

<main><a id="link" href={url('/invoices/[id]', { id: 4 })}>four</a><p id="total">{invoice().total}</p></main>`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    process.env.APP_URL = 'http://example.test/docs/'
    ;({ base, stop } = await serveApp({
        'ui/pages/page.abide': PAGE,
        'ui/pages/invoices/[id]/page.abide': '<main>an invoice</main>',
        'ui/public/robots.txt': 'User-agent: *\n',
        'server/rpc/invoices.ts': `import { GET } from 'abide/server'\n\nexport const getInvoice = GET(async ({ id }: { id: string }) => ({ id, total: 99 }))\n`,
    }))
    delete process.env.APP_URL
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// 16.11 — THE DOCUMENT NAMES THE MOUNT AND LOADS EVERYTHING FROM UNDER IT, and an address `url` built
// is under it too. THE REVERT: leave `clientTags` on `CLIENT_ADDRESS` bare; the entry is asked for at
// the root, where nothing of this app's is.
test('a page under the mount loads from under it — 16.11', async () => {
    const answer = await Bun.fetch(`${base}/docs/`)
    expect(answer.status).toBe(200)
    const html = await answer.text()
    expect(html).toContain('<meta name="abide-mount" content="/docs">')
    expect(html).toMatch(
        /<script type="module" src="\/docs\/__abide\/client\/entry-[^"]+\.js">/,
    )
    expect(html).toContain('<a id="link" href="/docs/invoices/4">four</a>')
    // 41.21 — the early call is the address the browser's own call is made at.
    expect(html).toContain('/docs/__abide/rpc/invoices/getInvoice?id=4')
    const entry = /src="(\/docs\/__abide\/client\/entry-[^"]+\.js)"/.exec(
        html,
    )?.[1] as string
    expect((await Bun.fetch(`${base}${entry}`)).status).toBe(200)
})

// 36.11 — every other address answers under the mount: a route, a handler, a public file.
test('routes, handlers and public files answer under the mount — 36.11', async () => {
    expect(await (await Bun.fetch(`${base}/docs/invoices/4`)).text()).toContain(
        'an invoice',
    )
    expect(
        await (
            await Bun.fetch(`${base}/docs/__abide/rpc/invoices/getInvoice?id=4`)
        ).json(),
    ).toEqual({
        id: '4',
        total: 99,
    })
    expect(await (await Bun.fetch(`${base}/docs/robots.txt`)).text()).toBe(
        'User-agent: *\n',
    )
})
