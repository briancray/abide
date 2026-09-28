// 41.5, 41.7, 41.13 AND 41.17-41.19 — THE BROWSER'S CALL IS ANSWERED FROM THE RENDER. What is counted
// is how many times the handler RAN, because an answer from a second run is the same invoice: the
// output cannot tell a seeded answer from a re-run, and the run count is the whole of the contract.

import { afterAll, beforeAll, expect, setSystemTime, test } from 'bun:test'
import { seedFor, takeSeed } from '#server/seedBuffer.ts'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

// SLOW ON PURPOSE. The render does not wait for it (41.4), so the call below arrives while the
// render's load is still in flight — the case 41.13 has join rather than run again.
const INVOICES = `import { GET } from 'abide/server'

let runs = 0

export const getInvoice = GET(async ({ id }: { id: string }) => {
    runs += 1
    const run = runs
    await new Promise((done) => setTimeout(done, 150))
    return { id, run }
})
`

const PAGE = `<script>
import { reactive } from 'abide'
import { getInvoice } from '#server/rpc/invoices.ts'

const invoice = reactive(() => getInvoice({ id: '4021' }))
</script>

<main><p id="total">{invoice().id}</p></main>`

// 26.9 — A RUNG THAT SIGNS THE CALLER OUT before the handler is reached, on a header of the test's.
const SIGN_OUT = `import { middleware, principal } from 'abide/server'

middleware((next, { request }) => {
    if (request.headers.get('x-sign-out') === '1') principal.clear()
    return next()
})
`

let stop = (): void => {}
let base = ''

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'ui/pages/page.abide': PAGE,
        'server/rpc/invoices.ts': INVOICES,
        'server/app.ts': SIGN_OUT,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

const CALL = '/__abide/rpc/invoices/getInvoice?id=4021'

async function call(
    cookie?: string,
    headers: Record<string, string> = {},
): Promise<{ id: string; run: number }> {
    const answer = await Bun.fetch(`${base}${CALL}`, {
        headers: cookie === undefined ? headers : { ...headers, cookie },
    })
    return (await answer.json()) as { id: string; run: number }
}

// 26.5, 26.12, 26.19 — a page mints the caller where the browser brought none, and not where it did.
test('a page mints the abide-caller cookie once, HttpOnly and SameSite=Lax — 26.5, 26.19', async () => {
    const first = await Bun.fetch(`${base}/`)
    await first.text()
    const minted = first.headers.get('set-cookie') ?? ''
    expect(minted).toMatch(/^abide-caller=[\w-]+/)
    expect(minted).toContain('HttpOnly')
    expect(minted.toLowerCase()).toContain('samesite=lax')

    const again = await Bun.fetch(`${base}/`, {
        headers: { cookie: minted.split(';')[0] as string },
    })
    await again.text()
    expect(again.headers.get('set-cookie')).toBeNull()
})

// A render for a caller, and its cookie. The render's own run of the handler is the one after
// whatever run was last answered — the counter is the module's, and these calls are serial.
async function render(): Promise<string> {
    const page = await Bun.fetch(`${base}/`)
    await page.text()
    return (page.headers.get('set-cookie') ?? '').split(';')[0] as string
}

// 41.13 — THE RENDER'S RUN ANSWERS THE BROWSER'S CALL, still in flight when the call arrives, and
// 41.17 — it answers that one call, so the next runs the handler. Anchored to a run taken BEFORE the
// render, because an answer from a fresh run is the same invoice one number higher. THE REVERT: skip
// `takeSeed` in `answerRpc`; the call is answered by a run of its own — 2 past the anchor where 1 is
// due.
test("the browser's call is answered from its render's run, once — 41.13, 41.17", async () => {
    const anchor = await call()
    const cookie = await render()
    expect((await call(cookie)).run).toBe(anchor.run + 1)
    expect((await call(cookie)).run).toBe(anchor.run + 2)
})

// 41.19 — matched by CALLER: another browser's render is not this browser's answer. THE REVERT: match
// on the handler and the args alone; the stranger is answered from the render — 1 past the anchor
// where 2 is due.
test("one browser's render does not answer another browser's call — 41.19", async () => {
    const anchor = await call()
    await render()
    const stranger = await call('abide-caller=nobody-rendered-for-this')
    expect(stranger.run).toBe(anchor.run + 2)
})

// 41.19 BY `principal.caller` AS IT STANDS, and 26.7, 26.9 — a caller signed out earlier in the
// request is rotated, so the render made for it before does not answer it. THE REVERT: match on the
// cookie the request arrived with (`callerOf` reading the header before `scope.caller`); the
// signed-out call is answered from the render — 1 past the anchor where 2 is due.
test('a caller signed out earlier in the request is not answered from its render — 41.19, 26.9', async () => {
    const anchor = await call()
    const cookie = await render()
    const signedOut = await call(cookie, { 'x-sign-out': '1' })
    expect(signedOut.run).toBe(anchor.run + 2)
})

// THE BUFFER ITSELF, IN PROCESS: matched by handler and args (41.19), taken once (41.17), and gone
// after its life whether or not its timer has fired (41.18).
test('an entry is matched by handler and args, taken once, and ends after 30 seconds — 41.17-41.19', async () => {
    const handler = {}
    const another = {}
    const seed = seedFor('caller-a')
    seed(handler, { id: '1' }, Promise.resolve('one'))
    seed(handler, { id: '2' }, Promise.resolve('two'))

    expect(takeSeed('caller-a', another, { id: '1' })).toBeUndefined()
    expect(takeSeed('caller-b', handler, { id: '1' })).toBeUndefined()
    expect(await takeSeed('caller-a', handler, { id: '1' })).toMatchObject({
        settled: true,
        value: 'one',
    })
    expect(takeSeed('caller-a', handler, { id: '1' })).toBeUndefined()

    // THE REVERT: drop the `expires` test in `takeSeed`; a late timer leaves the entry answering.
    setSystemTime(new Date(Date.now() + 31_000))
    try {
        expect(takeSeed('caller-a', handler, { id: '2' })).toBeUndefined()
    } finally {
        setSystemTime()
    }
})

// ONE KEY, SEVERAL RENDERS: each render leaves its own entry under the same caller, handler and args,
// and each call takes one, oldest first — then the index is empty again, and a later render fills it.
test('entries under one key are taken oldest first, one a call — 41.17, 41.19', async () => {
    const handler = {}
    seedFor('caller-c')(handler, { id: '1' }, Promise.resolve('first'))
    seedFor('caller-c')(handler, { id: '1' }, Promise.resolve('second'))
    expect(await takeSeed('caller-c', handler, { id: '1' })).toMatchObject({
        value: 'first',
    })
    expect(await takeSeed('caller-c', handler, { id: '1' })).toMatchObject({
        value: 'second',
    })
    expect(takeSeed('caller-c', handler, { id: '1' })).toBeUndefined()
    seedFor('caller-c')(handler, { id: '1' }, Promise.resolve('third'))
    expect(await takeSeed('caller-c', handler, { id: '1' })).toMatchObject({
        value: 'third',
    })
})

// 41.21 — THE PAGE'S CALLS ARE STARTED FROM THE HEAD, before any markup, as the requests the
// browser's own `Rpc` makes — addresses, not answers (41.5). THE REVERT: drop the early-call
// `yield` in `render`; the head carries no script and the call leaves only once the bundle runs.
test('the head starts every call the page made, before its markup — 41.21', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    const script =
        /<script type="application\/json">[\s\S]*?<\/script><script>\(function\(s,c\)[\s\S]*?<\/script>/.exec(
            html,
        )?.[0] ?? ''
    expect(script).toContain('/__abide/rpc/invoices/getInvoice?id=4021')
    expect(script).toContain('__abideCalls')
    // In the head, and ahead of the markup.
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('</head>'))
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('<main>'))
    // A call, not an answer: nothing the handler returns is in it.
    expect(script).not.toContain('"run"')
})

// 21.15 — the handler's time on every answer, and the render's run named where it answered.
test("an answer says how long its handler took, and whether the render's run answered it — 21.15", async () => {
    const cookie = await render()
    const seeded = await Bun.fetch(`${base}${CALL}`, { headers: { cookie } })
    // This app runs a rung, so `Middleware` follows (21.20).
    expect(seeded.headers.get('server-timing')).toMatch(
        /^Seeded;dur=[\d.]+, Middleware;/,
    )
    const fresh = await Bun.fetch(`${base}${CALL}`)
    expect(fresh.headers.get('server-timing')).toMatch(
        /^Direct;dur=[\d.]+, Middleware;/,
    )
    // The slow handler's own 150 ms, not the request's.
    const duration = Number(
        /dur=([\d.]+)/.exec(fresh.headers.get('server-timing') ?? '')?.[1],
    )
    expect(duration).toBeGreaterThanOrEqual(140)
})
