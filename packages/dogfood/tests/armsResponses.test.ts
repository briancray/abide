// THE ARMS BEHIND THE RESPONSE CARDS — what a handler's answer goes out as: events, lines,
// bytes, a redirect, a document, a status, a method. What an arm spec is for is said at the head
// of `arms.test.ts`.
import { expect, test } from 'bun:test'
import {
    ARMS_DIR,
    click,
    mount,
    read,
    routesOf,
    streamingFetch,
} from './armDrivers.ts'

test('stream-rows: the rows paint as they land and the count waits for the close', async () => {
    const REGIONS = [
        '{ "code": "no", "name": "North", "total": "$412k" }',
        '{ "code": "so", "name": "South", "total": "$208k" }',
        '{ "code": "ea", "name": "East", "total": "$96k" }',
    ]
    // A wide step, because the assertions are about WHICH row has landed: at 60ms they were
    // inside the scheduling noise of a loaded run and this failed in the file and passed alone.
    globalThis.fetch = streamingFetch({ '': REGIONS }, 250)

    const landed = () => [
        document.querySelectorAll('#rows li').length,
        read('#count'),
    ]

    await mount('stream-rows', 'report.js')
    await Bun.sleep(350)

    // THE CLAIM. One call read two ways: the block has the row that landed, and the
    // accumulation has nothing to serve until the stream closes.
    expect(landed()).toEqual([1, '…'])

    await Bun.sleep(250)
    expect(landed()).toEqual([2, '…'])

    await Bun.sleep(500)
    expect(landed()).toEqual([3, '3'])
})

// AN ARM'S OWN ROUTES BEHIND `fetch`, so a spec drives the page and the server it wrote as one
// thing. A route may be a function or a table by method, which is what `Bun.serve` takes.
type MethodRoutes = Record<
    string,
    | ((request: Request) => Response | Promise<Response>)
    | Record<string, (request: Request) => Response | Promise<Response>>
>

function servedBy(routes: MethodRoutes, asked: string[] = []): typeof fetch {
    return Object.assign(
        async (input: string, init?: RequestInit) => {
            const method = init?.method ?? 'GET'
            asked.push(`${method} ${input}`)
            const url = new URL(input, 'http://example.invalid')
            const route = routes[url.pathname]
            const handler =
                typeof route === 'function' ? route : route?.[method]
            return (
                (await handler?.(new Request(url, init))) ??
                new Response('', { status: 404 })
            )
        },
        { preconnect: () => {} },
    ) as typeof fetch
}

// Reverted — the route's content-type written as `application/jsonl` — the readout reads that
// where 'text/event-stream' was owed.
test('sse-wallboard: a caller that sent no Accept is answered events', async () => {
    const routes = await routesOf('sse-wallboard', 'server.ts')
    globalThis.fetch = servedBy(routes)

    await mount('sse-wallboard', 'feed.js')
    await Bun.sleep(1200)
    // THE CLAIM: the request asked for nothing, and the answer is framed as events.
    expect(read('#type')).toBe('text/event-stream')
    expect(read('#body').trim().split('\n\n')).toEqual([
        'data: {"page":"/pricing","at":"09:41:02"}',
        'data: {"page":"/signup","at":"09:41:05"}',
        'data: {"page":"/docs","at":"09:41:09"}',
    ])
})

// Reverted — the route answering `Response.json(rows)` — the body is one line holding an array,
// which reads as one row with no region where three regions were owed.
test('jsonl-export: a list goes out one value per line', async () => {
    const routes = await routesOf('jsonl-export', 'server.ts')
    globalThis.fetch = servedBy(routes)

    await mount('jsonl-export', 'export.js')
    await Bun.sleep(50)
    expect(read('#type')).toBe('application/jsonl')
    // THE CLAIM: every line parses on its own, and there is one per row.
    const lines = read('#body').trim().split('\n')
    expect(lines.map((line) => JSON.parse(line).region)).toEqual([
        'north',
        'south',
        'east',
    ])
})

// Reverted — the route writing the whole file as its first chunk — the first read takes 4 lines
// where the header line alone was owed.
test('bytes-csv: the file is written as the rows are read', async () => {
    const routes = await routesOf('bytes-csv', 'server.ts')
    const answer = await routes['/api/salesCsv']?.(
        new Request('http://example.invalid/api/salesCsv?year=2026'),
    )
    expect(answer?.headers.get('content-type')).toBe('application/octet-stream')
    // THE CLAIM: the first chunk is the header line alone, ahead of any row.
    const reader = (
        answer as Response
    ).body?.getReader() as ReadableStreamDefaultReader<Uint8Array>
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe('region,total\n')
    await reader.cancel()

    globalThis.fetch = servedBy(routes)
    await mount('bytes-csv', 'csv.js')
    await Bun.sleep(1200)
    expect(read('#body').trim().split('\n')).toEqual([
        'region,total',
        'north,12480.00',
        'south,9140.00',
        'east,7020.00',
    ])
})

// Reverted — the route answering `new Response(null, { status: 204 })` for nobody — the script's
// `json()` throws on the empty body and the readouts stay at Ada's '200' and 'Charles Babbage'.
test('json-null: nobody is `null` at 200, not an empty answer', async () => {
    const routes = await routesOf('json-null', 'server.ts')
    globalThis.fetch = servedBy(routes)

    await mount('json-null', 'manager.js')
    await Bun.sleep(30)
    expect([read('#status'), read('#manager')]).toEqual([
        '200',
        'Charles Babbage',
    ])
    // THE CLAIM: Grace has no manager, and the answer still reads as JSON.
    click('#grace')
    await Bun.sleep(30)
    expect([read('#status'), read('#manager')]).toEqual(['200', 'null'])
})

// Reverted — the avatar route answering a photo itself — 200 and no `location`, where 302 and
// the current version's address were owed.
test('redirect-avatar: the stable address sends the browser on to the version', async () => {
    const routes = await routesOf('redirect-avatar', 'server.ts')
    // THE CLAIM: the address the page asks for answers a redirect to the current version.
    const answer = await routes['/api/avatar']?.(
        new Request('http://example.invalid/api/avatar?id=4022'),
    )
    expect([answer?.status, answer?.headers.get('location')]).toEqual([
        302,
        '/api/photo?id=4022&version=7',
    ])
    const photo = await routes['/api/photo']?.(
        new Request(`http://example.invalid${answer?.headers.get('location')}`),
    )
    expect(photo?.headers.get('content-type')).toBe('image/svg+xml')

    await mount('redirect-avatar', 'avatar.js')
    click('#grace')
    expect(read('#asked')).toBe('/api/avatar?id=4022')
})

// Reverted — the route's `content-type` left off — the answer is typed `text/plain;charset=UTF-8`,
// which a browser under `nosniff` shows as text rather than painting the invoice.
test('page-issued: the stored invoice is answered as a document', async () => {
    const routes = await routesOf('page-issued', 'server.ts')
    const answer = await routes['/api/issuedInvoice']?.(
        new Request('http://example.invalid/api/issuedInvoice?id=4021'),
    )
    // THE CLAIM: the stored HTML goes out as HTML, unchanged.
    expect(answer?.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await answer?.text()).toContain('<h1>Invoice INV-4021</h1>')

    // The page is the frame pointed at that route. Read rather than mounted: happy-dom would load
    // the frame itself, against a server this spec never started.
    const page = await Bun.file(
        new URL('page-issued/invoice.js', ARMS_DIR),
    ).text()
    expect(page).toContain("'/api/issuedInvoice?id=4021'")
})

// Reverted — the route answering `Response.json(contact)` with no init — the readouts read '200'
// and '' where '201' and the new record's address were owed.
test("response-created: the status and the location are the handler's to write", async () => {
    const routes = await routesOf('response-created', 'server.ts')
    globalThis.fetch = servedBy(routes)

    await mount('response-created', 'contact.js')
    expect([read('#status'), read('#location')]).toEqual(['—', '—'])
    click('#add')
    await Bun.sleep(30)
    // THE CLAIM: a create answers 201 and says where the record now lives.
    expect([read('#status'), read('#location')]).toEqual([
        '201',
        '/contacts/4031',
    ])
})

// Reverted — `DELETE` sent with the tag in a JSON body, as the other writes send theirs — the
// route reads no `tag` off the URL, removes nothing, and three tags stand where two were owed.
test('write-methods: each write goes out on its own method', async () => {
    const routes = (await routesOf(
        'write-methods',
        'server.ts',
    )) as unknown as MethodRoutes
    const asked: string[] = []
    globalThis.fetch = servedBy(routes, asked)
    const tags = () =>
        [...document.querySelectorAll('#tags button')].map(
            (button) => button.textContent,
        )

    await mount('write-methods', 'contact.js')
    await Bun.sleep(30)
    expect([read('#phone'), tags()]).toEqual([
        '020 7946 0018',
        ['customer ✕', 'newsletter ✕', 'vip ✕'],
    ])

    click('#save')
    await Bun.sleep(30)
    ;(document.querySelectorAll('#tags button')[1] as HTMLElement).click()
    await Bun.sleep(30)
    expect([read('#phone'), tags()]).toEqual([
        '020 7946 0019',
        ['customer ✕', 'vip ✕'],
    ])
    click('#reset')
    await Bun.sleep(30)
    expect(tags()).toEqual(['customer ✕', 'newsletter ✕', 'vip ✕'])
    // THE CLAIM, and what the arm pays for it: four verbs, each a string here that the server's
    // route table has to agree with, and a query built by hand for the one carrying it in the URL.
    expect(asked).toEqual([
        'GET /api/contact?id=4021',
        'PATCH /api/contact',
        'DELETE /api/contact?id=4021&tag=newsletter',
        'PUT /api/contact',
    ])
})
