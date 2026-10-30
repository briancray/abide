// 41.5, 41.7, 41.13 AND 41.16-41.18 — THE BROWSER'S CALL IS ANSWERED FROM THE RENDER. What is counted
// is how many times the handler RAN, because an answer from a second run is the same invoice: the
// output cannot tell a seeded answer from a rerun, and the run count is the whole of the contract.

import { afterAll, beforeAll, expect, setSystemTime, test } from 'bun:test'

import { onConfig } from '#server/hooks.ts'
import { seedFor, takeSeed } from '#server/seedBuffer.ts'
import { reactive } from '#shared/reactive/index.ts'

import { handlerFiles, serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

// SLOW ON PURPOSE. The render does not wait for it (41.4), so the call below arrives while the
// render's load is still in flight — the case 41.13 has join rather than run again.
const INVOICES = `import { GET } from '@abide/abide/server'

let runs = 0

export const getInvoice = GET(async ({ id }: { id: string }) => {
    runs += 1
    const run = runs
    await new Promise((done) => setTimeout(done, 150))
    return { id, run }
})
`

const PAGE = `<script>
import { reactive } from '@abide/abide'
import getInvoice from '#src/invoices/getInvoice.handler.ts'

const invoice = reactive(() => getInvoice({ id: '4021' }))
</script>

<main><p id="total">{invoice().id}</p></main>`

// 26.9 — A RUNG THAT SIGNS THE CALLER OUT before the handler is reached, on a header of the test's.
const SIGN_OUT = `import { middleware, principal } from '@abide/abide/server'

middleware((next, { request }) => {
    if (request.headers.get('x-sign-out') === '1') principal.clear()
    return next()
})
`

// 41.25, 41.26 — ONE CALL OF EACH KIND A PAGE IS PAINTED FROM: answered within the render's turn,
// refused within it, and a stream that has closed within it.
const TOTALS = `import { GET, refuse } from '@abide/abide/server'

export const getTotal = GET(({ id }: { id: string }) => ({ id, total: 12 }))

export const getMissing = GET(({ id }: { id: string }) => refuse(404, id))

export const getLines = GET(async function* ({ id }: { id: string }) {
    yield id
})
`

const PAINTED = `<script>
import { reactive } from '@abide/abide'
import getLines from '#src/totals/getLines.handler.ts'
import getMissing from '#src/totals/getMissing.handler.ts'
import getTotal from '#src/totals/getTotal.handler.ts'

const total = reactive(() => getTotal({ id: 't' }))
const missing = reactive(() => getMissing({ id: 'm' }))
const lines = reactive(() => getLines({ id: 'l' }))
</script>

<main><p>{total.busy()}</p><p>{missing.error()}</p><p>{lines.busy()}</p></main>`

// 18.5, 41.13 — A `global` VALUE A RENDER READ, and a write that moves it before the browser's call.
const SHELF = `import { GET, POST, reactive } from '@abide/abide/server'

const shelf = reactive<string[]>(['dune'], { global: true })

export const books = GET(shelf)

export const shelve = POST(({ title }: { title: string }) => {
    shelf.set([...shelf(), title])
})
`

// 41.13 — A STREAM STILL RUNNING WHEN THE PAGE IS ANSWERED, which the browser's call then joins.
const FEED = `import { GET } from '@abide/abide/server'

export const getFeed = GET(async function* () {
    for (const line of ['one', 'two', 'three']) {
        await new Promise((done) => setTimeout(done, 100))
        yield line
    }
})
`

const FEED_PAGE = `<script>
import { reactive } from '@abide/abide'
import getFeed from '#src/feed/getFeed.handler.ts'

const lines = reactive(() => getFeed())
</script>

<main><p>{lines.busy()}</p></main>`

// 18.23 — A `global` VALUE HOLDING A BINARY.
const COVERS = `import { GET, reactive } from '@abide/abide/server'

const cover = reactive(new Blob(['png'], { type: 'image/png' }), { global: true })

export const art = GET(cover)
`

const SHELF_PAGE = `<script>
import { reactive } from '@abide/abide'
import books from '#src/shelf/books.handler.ts'

const shelved = reactive(() => books())
</script>

<main><p>{shelved()}</p></main>`

let stop = (): void => {}
let base = ''

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'index.abide': PAGE,
        'painted/index.abide': PAINTED,
        'shelf/index.abide': SHELF_PAGE,
        'feeds/index.abide': FEED_PAGE,
        ...handlerFiles('feed', FEED),
        ...handlerFiles('shelf', SHELF),
        ...handlerFiles('covers', COVERS),
        ...handlerFiles('totals', TOTALS),
        ...handlerFiles('invoices', INVOICES),
        'layout.abide': `<script server>
${SIGN_OUT}</script>
`,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

const CALL = '/invoices/getInvoice?id=4021'

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
// 41.16 — it answers that one call, so the next runs the handler. Anchored to a run taken BEFORE the
// render, because an answer from a fresh run is the same invoice one number higher. THE REVERT: skip
// `takeSeed` in `answerRpc`; the call is answered by a run of its own — 2 past the anchor where 1 is
// due.
test("the browser's call is answered from its render's run, once — 41.13, 41.16", async () => {
    const anchor = await call()
    const cookie = await render()
    expect((await call(cookie)).run).toBe(anchor.run + 1)
    expect((await call(cookie)).run).toBe(anchor.run + 2)
})

// 41.13 — THE RENDER'S STREAM OUTLIVES THE PAGE'S ANSWER for the call that joins it: the page is
// answered before the stream's first line, and the scope that answer releases is the one the stream
// runs in. THE REVERT: drop the hold in `seedFor`; the scope's release stops the stream, it never
// closes, and the call hangs past its deadline.
test("a stream the render started still answers the browser's call — 41.13", async () => {
    const page = await Bun.fetch(`${base}/feeds`)
    await page.text()
    const cookie = (page.headers.get('set-cookie') ?? '').split(
        ';',
    )[0] as string
    const answer = await Bun.fetch(`${base}/feed/getFeed`, {
        headers: { cookie },
        signal: AbortSignal.timeout(3000),
    })
    expect((await answer.text()).trim().split('\n')).toHaveLength(3)
})

// 41.18 — matched by CALLER: another browser's render is not this browser's answer. THE REVERT: match
// on the handler and the args alone; the stranger is answered from the render — 1 past the anchor
// where 2 is due.
test("one browser's render does not answer another browser's call — 41.18", async () => {
    const anchor = await call()
    await render()
    const stranger = await call('abide-caller=nobody-rendered-for-this')
    expect(stranger.run).toBe(anchor.run + 2)
})

// 41.18 BY `principal.caller` AS IT STANDS, and 26.7, 26.9 — a caller signed out earlier in the
// request is rotated, so the render made for it before does not answer it. THE REVERT: match on the
// cookie the request arrived with (`callerOf` reading the header before `scope.caller`); the
// signed-out call is answered from the render — 1 past the anchor where 2 is due.
test('a caller signed out earlier in the request is not answered from its render — 41.18, 26.9', async () => {
    const anchor = await call()
    const cookie = await render()
    const signedOut = await call(cookie, { 'x-sign-out': '1' })
    expect(signedOut.run).toBe(anchor.run + 2)
})

// THE BUFFER ITSELF, IN PROCESS: matched by handler and args (41.18), taken once (41.16), and gone
// after its life whether or not its timer has fired (41.17).
test('an entry is matched by handler and args, taken once, and ends after 30 seconds — 41.16-41.18', async () => {
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
test('entries under one key are taken oldest first, one a call — 41.16, 41.18', async () => {
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

// 41.20 — THE PAGE'S CALLS ARE STARTED FROM THE HEAD, before any markup, as the requests the
// browser's own `Rpc` makes — addresses, not answers (41.5). THE REVERT: drop the early-call
// `yield` in `render`; the head carries no script and the call leaves only once the bundle runs.
test('the head starts every call the page made, before its markup — 41.20', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    const script =
        /<script type="application\/json">[\s\S]*?<\/script><script>\(function\(s,c,w\)[\s\S]*?<\/script>/.exec(
            html,
        )?.[0] ?? ''
    expect(script).toContain('/invoices/getInvoice?id=4021')
    expect(script).toContain('__abideCalls')
    // In the head, and ahead of the markup.
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('</head>'))
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('<main>'))
    // A call, not an answer: nothing the handler returns is in it.
    expect(script).not.toContain('"run"')
})

// 41.25 — A CALL THE MARKUP WAS BUILT FROM SETTLED IS MARKED for hydration to wait on, a refusal too,
// and one still in flight (the slow invoice on `/`) is not. 41.26 — nor is a stream, though this one
// closed before the markup was built. THE REVERTS: write every row unmarked, and `getTotal` and
// `getMissing` read `false`; drop `!isStreaming` from the mark, and `getLines` reads `true`.
test('the head marks the calls the markup was built from settled — 41.25, 41.26', async () => {
    const rowsOf = async (address: string) =>
        JSON.parse(
            /<script type="application\/json">([\s\S]*?)<\/script>/.exec(
                await (await Bun.fetch(`${base}${address}`)).text(),
            )?.[1] ?? '[]',
        ) as unknown[][]
    const marked: Record<string, boolean> = {}
    for (const row of [...(await rowsOf('/painted')), ...(await rowsOf('/'))])
        marked[String(row[1]).split('?')[0]?.split('/').pop() ?? ''] =
            row[3] === 1
    expect(marked).toEqual({
        getTotal: true,
        getMissing: true,
        getLines: false,
        getInvoice: false,
    })
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

/** The `abide:hydrate` lines `body` logs. */
async function hydrateWarnings(body: () => unknown): Promise<string[]> {
    const warned: string[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]) => {
        warned.push(args.map(String).join(' '))
    }
    try {
        await body()
    } finally {
        console.warn = warn
    }
    return warned.filter((line) => line.includes('abide:hydrate'))
}

// 41.12 — A CALL THE BUFFER CANNOT ANSWER RUNS THE HANDLER AND WARNS, where the buffer can tell the call
// was its to answer: the render left this handler an entry, for other args. A call for args an entry
// already answered is a refresh, and is quiet. THE REVERT: drop the `missed` call for args with no
// list in `takeSeed`; 0 warnings where 1 is due. And keep `drop` deleting a key's emptied list; the
// refresh warns too, 2 where 1 is due.
test('a call the render made with other args runs the handler and warns on abide:hydrate, and a refresh is quiet — 41.12, 41.22', async () => {
    const handler = { address: '/invoices/getInvoice' }
    const seed = seedFor('caller-miss')
    seed(handler, { id: 1 }, Promise.resolve('one'))
    seed(handler, { id: 2 }, Promise.resolve('two'))
    const warned = await hydrateWarnings(async () => {
        // 19.7's case: the render passed a number, and the query arrives as text.
        expect(takeSeed('caller-miss', handler, { id: '1' })).toBeUndefined()
        expect(await takeSeed('caller-miss', handler, { id: 1 })).toMatchObject(
            {
                value: 'one',
            },
        )
        // The refresh, while the entry for 2 still stands.
        expect(takeSeed('caller-miss', handler, { id: 1 })).toBeUndefined()
    })
    expect(warned.length).toBe(1)
    expect(warned[0]).toContain('/invoices/getInvoice')
    expect(warned[0]).toContain('41.12')
})

// 16.33 — A STREAM'S TRANSCRIPT PAST `ABIDE_MAX_STREAM_BUFFER_SIZE` STOPS BEING HELD, and its call is
// one the buffer cannot answer (41.12). Counted in jsonl bytes: `"aaaa"\n` is 7, so two chunks pass
// 10 and one does not. THE REVERT: skip `boundTranscript` in `seedFor`; the entry over the bound
// answers, and 0 warnings arrive where 1 is due.
test('a seeded stream whose transcript passes ABIDE_MAX_STREAM_BUFFER_SIZE is not answered from the buffer — 16.33, 41.12', async () => {
    const unfile = onConfig(() => ({ ABIDE_MAX_STREAM_BUFFER_SIZE: 10 }))
    try {
        const handler = { address: '/reports/rows' }
        const streamOf = (count: number) =>
            reactive(async function* () {
                for (let at = 0; at < count; at += 1) yield 'aaaa'
            })
        const over = streamOf(2)
        const under = streamOf(1)
        seedFor('caller-bound')(handler, { size: 2 }, over)
        seedFor('caller-bound')(handler, { size: 1 }, under)
        await over
        await under
        await Bun.sleep(0)
        const warned = await hydrateWarnings(async () => {
            expect(
                takeSeed('caller-bound', handler, { size: 2 }),
            ).toBeUndefined()
            expect(takeSeed('caller-bound', handler, { size: 1 })).toBeDefined()
        })
        expect(warned.length).toBe(1)
        expect(warned[0]).toContain('ABIDE_MAX_STREAM_BUFFER_SIZE')
    } finally {
        unfile()
    }
})

// 18.22 — A SEEDED ANSWER NAMES THE VERSION OF WHAT IT CARRIES. The render reached the shelf before the
// write, so its seed is the old production, and the version standing now would have the browser
// follow from a body it never got — sent nothing until the shelf next moved. THE REVERT: stamp
// `answerOutcome`'s etag from the value's standing production whatever was answered; the seeded
// answer reads 'current' with the old shelf.
test('a seeded answer the production moved past does not name the version standing now — 18.22, 41.13', async () => {
    const page = await Bun.fetch(`${base}/shelf`)
    await page.text()
    const cookie = (page.headers.get('set-cookie') ?? '').split(
        ';',
    )[0] as string
    const shelved = await Bun.fetch(`${base}/shelf/shelve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'emma' }),
    })
    await shelved.text()
    const seeded = await Bun.fetch(`${base}/shelf/books`, {
        headers: { cookie },
    })
    const fresh = await Bun.fetch(`${base}/shelf/books`)
    const standing = fresh.headers.get('etag')
    expect(
        `${await seeded.text()} ${seeded.headers.get('etag') === standing ? 'current' : 'not current'}`,
    ).toBe('["dune"] not current')
    expect(await fresh.text()).toBe('["dune","emma"]')
})

// 18.23 — A BINARY CARRIES NO VERSION, so nothing follows it: a reader asking for an event stream is
// answered the bytes. THE REVERT: drop the binary arm from `answerOutcome`'s `serving`; the answer is
// a follow, 'text/event-stream' where 'image/png' is due.
test('a global GET answering a binary is answered, not followed — 18.23', async () => {
    const answer = await Bun.fetch(`${base}/covers/art`, {
        headers: { accept: 'text/event-stream' },
    })
    await answer.body?.cancel()
    expect(String(answer.headers.get('content-type'))).toBe('image/png')
})
