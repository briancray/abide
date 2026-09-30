// 35.2, 35.3 — THE PAGE A REFUSAL RENDERS IN, over a served app (spawned, for `serve.test.ts`'s reason).

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const ROOT_ERROR = `<script>
import { notFound, props, type Failed } from 'abide'

const { failure } = props<{ failure: Failed<string, unknown> }>()
</script>

{#if notFound.is(failure)}
<h1 id="root">No such page</h1>
<p id="where">Nothing answers {failure.data.method} {failure.data.path}.</p>
{:else}
<h1>Something went wrong</h1>
{/if}`

const SECTION_ERROR = `<script>
import { props, type Failed } from 'abide'

const { failure } = props<{ failure: Failed<string, unknown> }>()
</script>

<h1 id="section">No such invoice ({failure.status})</h1>`

// An error page that fails as it renders.
const BROKEN_ERROR = `<script>
import { props } from 'abide'

const { failure } = props<{ failure: { data: { path: string } } }>()
const missing = undefined as unknown as { boom: string }
</script>

<p>{missing.boom} {failure.data.path}</p>`

// 16.39 — handlers a form posts to with no script on the page.
const FORMS = `import { POST, redirect, refuse } from 'abide/server'

export const save = POST(({ amount }: { amount: string | string[] }) =>
    Number(amount) > 0 ? { saved: amount } : refuse(422, 'The amount has to be above zero.'),
)

export const move = POST(() => redirect('/elsewhere', 303))
`

// 41.1, 35.2 — A DETAIL PAGE WHOSE RECORD IS NOT THERE. The handler refuses, the page reads the
// refusal while it is built, and nothing of the document has gone out yet.
const RECORDS = `import { GET, notFound } from 'abide/server'

export const record = GET(({ id }: { id: number }) => (id === 1 ? { title: 'The first record' } : notFound()))
`

const RECORD_PAGE = `<script>
import { reactive, route } from 'abide'
import { record } from '#server/rpc/records'

const found = reactive(() => record({ id: Number(route.params().id) }))
</script>

<head><title>{found.title}</title></head>
<h1 id="record">{found.title}</h1>`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'ui/pages/page.abide': '<main>home</main>',
        'ui/pages/error.abide': ROOT_ERROR,
        'ui/pages/invoices/[id]/page.abide': '<main>an invoice</main>',
        'ui/pages/invoices/error.abide': SECTION_ERROR,
        'ui/pages/broken/error.abide': BROKEN_ERROR,
        'ui/pages/tax returns/page.abide': '<main>tax returns</main>',
        'ui/pages/tax returns/error.abide':
            '<h1 id="encoded">No such return</h1>',
        'server/rpc/forms.ts': FORMS,
        'server/rpc/records.ts': RECORDS,
        'ui/pages/records/[id]/page.abide': RECORD_PAGE,
        'ui/pages/records/error.abide': `<script>
import { props, type Failed } from 'abide'

const { failure } = props<{ failure: Failed<string, unknown> }>()
</script>

<h1 id="records">No such record ({failure.status})</h1>`,
        'ui/pages/thrown/page.abide': `<script>
const missing = undefined as unknown as { boom: string }
</script>

<p>{missing.boom}</p>`,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// 35.2, 15.7 — AN ADDRESS NOTHING ANSWERS IS `notFound`, rendered by the nearest error page at 404.
test('an unmatched address renders the root error page at 404 — 35.2', async () => {
    const answer = await Bun.fetch(`${base}/nowhere`)
    expect(answer.status).toBe(404)
    expect(answer.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const html = await answer.text()
    expect(html).toContain('<h1 id="root">No such page</h1>')
    expect(html).toContain('Nothing answers GET /nowhere.')
})

// 35.2 — NEAREST-ANCESTOR BY THE ADDRESS THE ROUTE MATCHED: a directory whose name is written
// percent-encoded is found by the decoded address, as its page is. THE REVERT: split the pathname
// without decoding in `errorsFor`; `/tax%20returns/missing` is answered by the root page.
test('an error page under a percent-encoded directory answers for it — 35.2', async () => {
    expect(await (await Bun.fetch(`${base}/tax%20returns`)).text()).toContain(
        'tax returns',
    )
    const answer = await Bun.fetch(`${base}/tax%20returns/missing`)
    expect(answer.status).toBe(404)
    expect(await answer.text()).toContain(
        '<h1 id="encoded">No such return</h1>',
    )
})

// 15.16 — AN ADDRESS THAT WILL NOT DECODE IS THE CALLER'S FAULT, painted by the root page. THE
// REVERT: drop the `decodes` check in `answerRequest`; `firstMatch` throws `URIError` and the
// answer is a 500.
test('an address that will not percent-decode is answered 400 — 15.16', async () => {
    const answer = await Bun.fetch(`${base}/%E0%A4%A`)
    expect(answer.status).toBe(400)
    expect(await answer.text()).toContain('Something went wrong')
})

// 35.2 — NEAREST-ANCESTOR, as a layout is. THE REVERT: sort the error pages shallowest first in
// `appSources`; `/invoices/42/lines` is answered by the root page.
test('the nearest error.abide answers for its own directory — 35.2', async () => {
    const answer = await Bun.fetch(`${base}/invoices/42/lines`)
    expect(answer.status).toBe(404)
    expect(await answer.text()).toContain(
        '<h1 id="section">No such invoice (404)</h1>',
    )
})

// 35.3 — AN ERROR PAGE THAT FAILS ESCALATES past its boundary to the next ancestor, rather than
// rendering half of itself.
test('an error page that fails escalates to the next ancestor — 35.3', async () => {
    const answer = await Bun.fetch(`${base}/broken/thing`)
    expect(answer.status).toBe(404)
    const html = await answer.text()
    expect(html).toContain('<h1 id="root">No such page</h1>')
    expect(html).not.toContain('boom')
})

const FORM_HEADERS = {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'content-type': 'application/x-www-form-urlencoded',
}

// The form's own page, on the app's own origin — 16.57 sends a foreign one to the root.
const formHeaders = (): Record<string, string> => ({
    ...FORM_HEADERS,
    referer: `${base}/invoices/42`,
})

// 41.1, 35.2 — A REFUSAL A PAGE READS WHILE IT IS BUILT IS THE DOCUMENT'S STATUS, painted by the nearest
// error page: nothing of the document has gone out, so the status is still the page's to decide.
// THE REVERT: yield the shell's head in `render` before the component is asked, as it was; the
// missing record answers 200, the document stopping short after its head.
test('a page whose record is refused answers at the refusal status — 41.1, 35.2', async () => {
    const found = await Bun.fetch(`${base}/records/1`)
    expect(found.status).toBe(200)
    const page = await found.text()
    expect(page).toContain('<title>The first record</title>')
    expect(page).toContain('<h1 id="record">The first record</h1>')

    const missing = await Bun.fetch(`${base}/records/2`)
    expect(missing.status).toBe(404)
    expect(await missing.text()).toContain(
        '<h1 id="records">No such record (404)</h1>',
    )
})

// 41.1, 16.42 — A PAGE THAT THROWS is the server's fault, answered 500 by the nearest error page.
test('a page that throws as it is built answers 500 — 41.1, 16.42', async () => {
    const answer = await Bun.fetch(`${base}/thrown`)
    expect(answer.status).toBe(500)
    expect(await answer.text()).toContain('<h1>Something went wrong</h1>')
})

// 16.39 — A FORM POSTED WITH NO SCRIPT IS ANSWERED AS A NAVIGATION: a value is a 303 back where the
// form was, a refusal is the error page at its own status, and a redirect passes through. A call made
// from a page's script is still answered as JSON. THE REVERT: drop the `navigation` branch from
// `answerRpc`; the form's reader is handed a JSON body where a page was due.
test('a mutation a form posted is answered as a navigation — 16.39', async () => {
    const saved = await Bun.fetch(`${base}/__abide/rpc/forms/save`, {
        method: 'POST',
        headers: formHeaders(),
        body: 'amount=5',
        redirect: 'manual',
    })
    expect(saved.status).toBe(303)
    expect(saved.headers.get('location')).toBe(`${base}/invoices/42`)

    const refused = await Bun.fetch(`${base}/__abide/rpc/forms/save`, {
        method: 'POST',
        headers: formHeaders(),
        body: 'amount=0',
    })
    expect(refused.status).toBe(422)
    expect(refused.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await refused.text()).toContain('<h1>Something went wrong</h1>')

    const moved = await Bun.fetch(`${base}/__abide/rpc/forms/move`, {
        method: 'POST',
        headers: formHeaders(),
        redirect: 'manual',
    })
    expect(moved.status).toBe(303)
    expect(moved.headers.get('location')).toBe('/elsewhere')

    const scripted = await Bun.fetch(`${base}/__abide/rpc/forms/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"amount":"7"}',
    })
    expect(await scripted.json()).toEqual({ saved: '7' })
})

// 16.57 — A `Referer` FROM ANOTHER ORIGIN IS NOT WHERE A FORM GOES BACK TO, and nor is one that is
// missing. THE REVERT: put `request.headers.get('referer') ?? '/'` back in `navigated`; the first
// reads `https://elsewhere.example/phish`.
test('a form posted with a foreign referer goes back to the root — 16.57', async () => {
    const post = (referer: string | undefined) =>
        Bun.fetch(`${base}/__abide/rpc/forms/save`, {
            method: 'POST',
            headers:
                referer === undefined
                    ? FORM_HEADERS
                    : { ...FORM_HEADERS, referer },
            body: 'amount=5',
            redirect: 'manual',
        })
    const foreign = await post('https://elsewhere.example/phish')
    expect(foreign.status).toBe(303)
    expect(foreign.headers.get('location')).toBe('/')
    expect((await post(undefined)).headers.get('location')).toBe('/')
})

// 15.17 — A PAGE ANSWERS `GET` AND `HEAD` ALONE, and another method is a refusal painted by the
// nearest error page, carrying what it would answer. THE REVERT: drop the `readsOnly` check ahead of
// the page in `answerRequest`; the POST renders the invoice at 200.
test('a page asked by another method is refused 405 with allow — 15.17', async () => {
    const answer = await Bun.fetch(`${base}/invoices/42`, { method: 'POST' })
    expect(answer.status).toBe(405)
    expect(answer.headers.get('allow')).toBe('GET, HEAD')
    expect(answer.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await answer.text()).not.toContain('an invoice')
})

// A `HEAD` IS THE PAGE'S HEADERS WITHOUT ITS RENDER: nothing is painted for a body the server drops,
// and no caller is minted for a request that never becomes a page. THE REVERT: drop the `HEAD`
// branch in `answerRequest`; the answer carries a `set-cookie`.
test('a HEAD for a page answers its headers and mints no caller', async () => {
    const answer = await Bun.fetch(`${base}/invoices/42`, { method: 'HEAD' })
    expect(answer.status).toBe(200)
    expect(answer.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(answer.headers.get('set-cookie')).toBeNull()
})
