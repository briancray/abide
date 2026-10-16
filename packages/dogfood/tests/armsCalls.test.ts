// THE ARMS BEHIND THE CALL CARDS — a call to the server, the refusals and schemas that guard
// it, the rungs in front of it, and the bound on a call's progress. What an arm spec is for is
// said at the head of `arms.test.ts`.
import { expect, test } from 'bun:test'
import {
    click,
    mount,
    read,
    routesOf,
    streamingFetch,
    type,
} from './armDrivers.ts'

test('rpc-call: the page gets the row with no API written between them', async () => {
    const asked: string[] = []
    globalThis.fetch = Object.assign(
        async (input: string) => {
            asked.push(input)
            await Bun.sleep(20)
            return Response.json({
                number: 'INV-4021',
                dueOn: '2026-10-01',
                total: '$82.40',
            })
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('rpc-call', 'invoice.js')
    await Bun.sleep(60)
    expect([read('#number'), read('#due'), read('#total')]).toEqual([
        'INV-4021',
        '2026-10-01',
        '$82.40',
    ])
    // THE CLAIM, and what the arm pays for it: the address and the argument encoding
    // are written out here, checked against nothing, and a renamed export is a 404
    // rather than a compile error.
    expect(asked).toEqual(['/api/invoices/get?id=4021'])
})

// The homepage's card. Reverted — the route dropped from `server.ts` — the heading reads
// '' where 'Invoice INV-0042' was owed, and the line reads the arm's own error branch.
test('read-invoice: the row the handler returns is the row on the page', async () => {
    const routes = await routesOf('read-invoice', 'server.ts')
    const asked: string[] = []
    globalThis.fetch = Object.assign(
        async (input: string) => {
            asked.push(input)
            const url = new URL(input, 'http://example.invalid')
            return (
                routes[url.pathname]?.(new Request(url)) ??
                new Response('', { status: 404 })
            )
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('read-invoice', 'invoice.js')
    await Bun.sleep(30)
    // THE CLAIM: a row from the database on the page, through the one handler.
    expect([read('#number'), read('#line')]).toEqual([
        'Invoice INV-0042',
        '$1,240.00 due 2026-09-14',
    ])
    // What the arm pays for it: an address and an encoding written out by hand on both
    // sides, and a miss the handler has to turn into a status the page then branches on.
    expect(asked).toEqual(['/api/invoice?id=42'])
    const missing = await routes['/api/invoice']?.(
        new Request('http://example.invalid/api/invoice?id=7'),
    )
    expect(missing?.status).toBe(404)
})

test('rpc-reactive: the button reads the probes off the call itself', async () => {
    let loads = 0
    globalThis.fetch = Object.assign(
        async () => {
            loads += 1
            await Bun.sleep(30)
            return Response.json({ total: loads === 1 ? '$82.40' : '$91.00' })
        },
        { preconnect: () => {} },
    ) as typeof fetch

    const disabled = (id: string) =>
        (document.querySelector(id) as HTMLButtonElement).disabled

    await mount('rpc-reactive', 'invoice.js')
    // Nothing is held, so the reminder cannot be sent yet.
    expect([disabled('#remind'), read('#total')]).toEqual([true, ''])

    await Bun.sleep(80)
    expect([disabled('#remind'), read('#total')]).toEqual([false, '$82.40'])

    // THE CLAIM. A promise answers once; this keeps answering. The reload is
    // `refreshing` rather than `pending`, so the button stays live and the total stays
    // up — and the arm needed two variables it tracked itself to say the same thing.
    click('#reload')
    expect([disabled('#remind'), read('#status'), read('#total')]).toEqual([
        false,
        'reloading…',
        '$82.40',
    ])

    await Bun.sleep(80)
    expect([read('#status'), read('#total')]).toEqual(['', '$91.00'])
})

test('rpc-follow: a change on the server reaches the list without a second read', async () => {
    const reads: string[] = []
    globalThis.fetch = Object.assign(
        async (url: string) => {
            reads.push(String(url))
            return Response.json(
                [
                    { id: 'acme', name: 'Acme Corp', stage: 'lead' },
                    { id: 'globex', name: 'Globex', stage: 'proposal' },
                ],
                { headers: { 'x-version': '7' } },
            )
        },
        { preconnect: () => {} },
    ) as unknown as typeof fetch
    const opened: {
        sent: string[]
        onopen?: () => void
        onmessage?: (event: { data: string }) => void
    }[] = []
    const unstubbed = globalThis.WebSocket
    globalThis.WebSocket = class {
        sent: string[] = []
        onopen?: () => void
        onmessage?: (event: { data: string }) => void
        constructor() {
            opened.push(this)
            queueMicrotask(() => this.onopen?.())
        }
        send(text: string) {
            this.sent.push(text)
        }
    } as unknown as typeof WebSocket
    try {
        await mount('rpc-follow', 'deals.js')
        await Bun.sleep(10)
        const stages = () =>
            [...document.querySelectorAll('#deals li span')].map(
                (one) => one.textContent,
            )
        expect(stages()).toEqual(['lead', 'proposal'])
        // The feed names the version the first read answered with.
        expect(opened[0]?.sent).toEqual([JSON.stringify({ since: 7 })])

        // THE CLAIM: the server's change arrives on the feed and the list follows it, with no
        // second read — the arm needed a socket, a frame format and a version of its own for it.
        opened[0]?.onmessage?.({
            data: JSON.stringify({
                deals: [
                    { id: 'acme', name: 'Acme Corp', stage: 'qualified' },
                    { id: 'globex', name: 'Globex', stage: 'proposal' },
                ],
            }),
        })
        expect(stages()).toEqual(['qualified', 'proposal'])
        expect(reads).toEqual(['/api/deals'])
    } finally {
        globalThis.WebSocket = unstubbed
    }
})

test('refuse-narrowed: each refusal is matched by name and gives back its own data', async () => {
    globalThis.fetch = Object.assign(
        async (input: string) => {
            const id = new URL(
                input,
                'http://example.invalid',
            ).searchParams.get('id')
            await Bun.sleep(20)
            if (id === '4311')
                return Response.json({
                    name: 'NotYours',
                    status: 403,
                    message: 'That invoice belongs to someone else.',
                    data: { owner: 'Grace Hopper' },
                })
            if (id === '4312')
                return Response.json({
                    name: 'Superseded',
                    status: 409,
                    message: 'That invoice was replaced.',
                    data: { replacedBy: '4408' },
                })
            return Response.json({ total: '$1,240.00' })
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('refuse-narrowed', 'invoice.js')
    await Bun.sleep(60)
    expect(read('#total')).toBe('$1,240.00')

    // THE CLAIM. Two refusals off one handler, and matching the name is what picks
    // between them — each branch reads a field the other refusal does not carry, so a
    // match that fell through would render `undefined` rather than the wrong sentence.
    click('#i4311')
    await Bun.sleep(60)
    expect([read('#message'), read('#total')]).toEqual([
        'Owned by Grace Hopper.',
        '—',
    ])

    click('#i4312')
    await Bun.sleep(60)
    expect([read('#message'), read('#total')]).toEqual([
        'Replaced by #4408.',
        '—',
    ])

    // And the answer that is not a refusal clears it.
    click('#i4310')
    await Bun.sleep(60)
    expect([
        (document.querySelector('#message') as HTMLElement).hidden,
        read('#total'),
    ]).toEqual([true, '$1,240.00'])
})

test('refuse-write: a refused write leaves the last good value standing', async () => {
    await mount('refuse-write', 'phone.js')
    expect(read('#stored')).toBe('(415) 555-0132')

    // THE CLAIM. The refusal fills the error and stores nothing, so the record keeps
    // what it had — the failure is beside the value rather than instead of it.
    type('#draft', '415 555 013')
    click('#save')
    expect([read('#message'), read('#stored')]).toEqual([
        '“415 555 013” is not ten digits.',
        '(415) 555-0132',
    ])

    // And the write that is accepted clears the standing failure.
    type('#draft', '415 555 0199')
    click('#save')
    expect([
        (document.querySelector('#message') as HTMLElement).hidden,
        read('#stored'),
    ]).toEqual([true, '(415) 555-0199'])
})

test('write-coalesced: two presses inside one flight are one write', async () => {
    let writes = 0
    globalThis.fetch = Object.assign(
        async () => {
            writes += 1
            const answered = writes
            await Bun.sleep(40)
            return Response.json(answered)
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('write-coalesced', 'pay.js')

    // THE CLAIM. The second press lands inside the first flight, so it is the same write
    // and gets that write's answer — the record carries one payment rather than two.
    click('#pay')
    click('#pay')
    expect(read('#status')).toBe('paying…')
    await Bun.sleep(90)
    expect([read('#payments'), String(writes)]).toEqual(['1', '1'])

    // And the window shuts with the response. A press after it is a second write, which is
    // what a `ttl` of 0 means and what a longer one would take away.
    click('#pay')
    await Bun.sleep(90)
    expect([read('#payments'), String(writes)]).toEqual(['2', '2'])
})

test('schema-browser: a refused write leaves the record and never reaches a server', async () => {
    let requests = 0
    globalThis.fetch = Object.assign(
        async () => {
            requests += 1
            return Response.json({})
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('schema-browser', 'email.js')
    expect(read('#stored')).toBe('ada@example.com')

    // THE CLAIM. The schema is declared where the value is, so the check is here — the
    // message is on screen with nothing having been sent.
    type('#email', 'ada@example')
    expect([read('#message'), read('#stored'), String(requests)]).toEqual([
        'That is not an email address.',
        'ada@example.com',
        '0',
    ])

    type('#email', 'ada@lovelace.org')
    expect([
        (document.querySelector('#message') as HTMLElement).hidden,
        read('#stored'),
        String(requests),
    ]).toEqual([true, 'ada@lovelace.org', '0'])
})

test('schema-issues: each message lands under the field its path names', async () => {
    const routes = await routesOf('schema-issues', 'server.ts')

    globalThis.fetch = Object.assign(
        async (input: string) => {
            const url = new URL(input, 'http://example.invalid')
            return (
                routes[url.pathname]?.(new Request(url)) ??
                new Response('', { status: 404 })
            )
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('schema-issues', 'search.js')
    await Bun.sleep(30)
    expect(read('#matches')).toBe('2')

    // THE CLAIM. Two fields refuse at once and each message is found by its own path, so
    // neither renders under the other — which a flat list of messages cannot promise.
    type('#query', 'i')
    type('#limit', '4')
    await Bun.sleep(30)
    expect([
        read('#query-issue'),
        read('#limit-issue'),
        read('#matches'),
    ]).toEqual(['Type at least two characters.', 'Between 1 and 3.', '—'])

    type('#query', 'inv')
    await Bun.sleep(30)
    expect([
        (document.querySelector('#query-issue') as HTMLElement).hidden,
        read('#limit-issue'),
    ]).toEqual([true, 'Between 1 and 3.'])
})

test('schema-key: two spellings of one key are two entries and two loads', async () => {
    const asked: string[] = []
    globalThis.fetch = Object.assign(
        async (input: string) => {
            const id = new URL(
                input,
                'http://example.invalid',
            ).searchParams.get('id')
            asked.push(id ?? '')
            await Bun.sleep(20)
            return Response.json({ ref: 'abc-123' })
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('schema-key', 'invoice.js')
    await Bun.sleep(50)
    expect([read('#ref'), asked.join(',')]).toEqual(['abc-123', 'ABC-123'])

    // THE CLAIM. The entry is filed under the arguments as sent, so the other spelling of
    // one invoice is a second entry and loads again.
    click('#lower')
    expect(read('#status')).toBe('loading…')
    await Bun.sleep(50)
    expect([read('#ref'), asked.join(',')]).toEqual([
        'abc-123',
        'ABC-123,abc-123',
    ])

    // And the first spelling is still held, so going back asks nothing.
    click('#upper')
    expect([read('#status'), asked.join(',')]).toEqual(['', 'ABC-123,abc-123'])
})

// Reverted — the parse hoisted above the sign-in check — a signed-out caller asking for nine reads
// `422 Unprocessable Content` where `401 Sign in first.` was owed.
test('rung-order: a signed-out caller is refused before the arguments are read', async () => {
    const routes = await routesOf('rung-order', 'server.ts')
    globalThis.fetch = Object.assign(
        async (input: string, init?: RequestInit) => {
            const url = new URL(input, 'http://example.invalid')
            return (
                routes[url.pathname]?.(new Request(url, init)) ??
                new Response('', { status: 404 })
            )
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('rung-order', 'recent.js')
    await Bun.sleep(20)
    expect([read('#status'), read('#count')]).toEqual([
        '401 Sign in first.',
        '—',
    ])

    // THE CLAIM. The argument is malformed either way, and which refusal comes back is
    // decided by the rung having run first — a signed-out caller never reads the schema
    // back out of a 422.
    type('#limit', '9')
    await Bun.sleep(20)
    expect(read('#status')).toBe('401 Sign in first.')

    click('#seal')
    await Bun.sleep(20)
    expect(read('#status')).toBe('422 Unprocessable Content')

    type('#limit', '2')
    await Bun.sleep(20)
    expect([read('#status'), read('#count')]).toEqual(['', '2'])
})

test('timeout-per-chunk: the bound is on progress, not on the whole report', async () => {
    globalThis.fetch = streamingFetch(
        { north: ['Oslo 412', 'Bergen 208', 'Tromsø 96'], south: [] },
        800,
    )

    // THE CLAIM. Three rows 800ms apart is 2.4s of report under a 2s bound, and none of
    // it is cut — a wall clock from the first byte would have taken the third row.
    await mount('timeout-per-chunk', 'report.js')
    await Bun.sleep(2900)
    expect([read('#rows'), read('#status')]).toEqual(['3', ''])

    // And the same number still catches a source that has stopped producing.
    click('#south')
    await Bun.sleep(2400)
    expect([read('#rows'), read('#status')]).toEqual([
        '—',
        '504 Gateway Timeout',
    ])
}, 20_000)

// Reverted — the sign-out cleared in the page, with no request — `asked` reads only the sign-in,
// and the HttpOnly seal the next request carries is still the signed-in one.
test('principal-session: the seal and what it resolved to move together', async () => {
    const asked: string[] = []
    globalThis.fetch = Object.assign(
        async (input: string, init?: RequestInit) => {
            asked.push(`${init?.method ?? 'GET'} ${input}`)
            return Response.json({
                authenticated: true,
                id: 'u_1',
                name: 'Ada Lovelace',
            })
        },
        { preconnect: () => {} },
    ) as typeof fetch

    await mount('principal-session', 'session.js')
    expect([read('#state'), read('#who'), read('#seal')]).toEqual([
        'no',
        '—',
        'Sign in',
    ])

    // THE CLAIM. Whether the seal was accepted and what the app resolved from it are one
    // thing, so a page cannot read "signed in" beside nobody, or a name beside "no".
    click('#seal')
    await Bun.sleep(20)
    expect([read('#state'), read('#who'), read('#seal')]).toEqual([
        'yes',
        'Ada Lovelace',
        'Sign out',
    ])

    // And signing out is a request too: the page cannot clear an HttpOnly seal.
    click('#seal')
    await Bun.sleep(20)
    expect([read('#state'), read('#who'), read('#seal')]).toEqual([
        'no',
        '—',
        'Sign in',
    ])
    expect(asked).toEqual(['POST /api/signIn', 'POST /api/signOut'])
})

// Reverted — the arm's `plan` rule dropped — the opening row reads one issue where two were owed.
test('validate-json: each issue sits under its own path and leaves when that field is fixed', async () => {
    await mount('validate-json', 'import.js')
    const issues = () => {
        const found: string[][] = []
        for (const item of document.querySelectorAll('#issues li'))
            found.push([
                item.querySelector('span')?.textContent ?? '',
                item.querySelector('strong')?.textContent ?? '',
            ])
        return found
    }
    expect(issues()).toEqual([
        ['plan', 'must be one of "starter", "team", "enterprise"'],
        ['seats', 'must be at most 50'],
    ])

    // THE CLAIM. Fixing one field takes its issue away and leaves the other's standing.
    type('#pasted', '{ "name": "Ada Lovelace", "plan": "team", "seats": 80 }')
    expect(issues()).toEqual([['seats', 'must be at most 50']])
    type('#pasted', '{ "name": "Ada Lovelace", "plan": "team", "seats": 12 }')
    expect(issues()).toEqual([['import', 'ready']])
    type('#pasted', '{ "name": ')
    expect(issues()).toEqual([['the row', 'must be object, was string']])
})

// Reverted — the arm's upper bound dropped — the third press reads 51 where the deal held 50.
test('json-schema: a write past the bound is refused and the deal keeps what it had', async () => {
    await mount('json-schema', 'seats.js')
    click('#more')
    click('#more')
    expect([read('#seats'), read('#message')]).toEqual(['50', ''])
    click('#more')
    expect([read('#seats'), read('#message')]).toEqual([
        '50',
        'must be at most 50',
    ])
    click('#fewer')
    expect([read('#seats'), read('#message')]).toEqual(['49', ''])
})
