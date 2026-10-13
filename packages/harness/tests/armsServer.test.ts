// THE ARMS BEHIND THE SERVER CARDS — sockets, cookies, log channels, the assistant relays, and
// the root layout's server hooks: start, config, health, principal, policy, middleware, traces, errors. What
// an arm spec is for is said at the head of `arms.test.ts`.
import { expect, test } from 'bun:test'
import { DOGFOOD } from '../scripts/exampleSources.ts'
import {
    ARMS_DIR,
    click,
    mount,
    type Routes,
    read,
    routesOf,
    type,
} from './armDrivers.ts'

test('log-channels: a line on a channel nothing selected is never recorded', async () => {
    await mount('log-channels', 'console.js')
    const lines = () =>
        [...document.querySelectorAll('#records li')].map(
            (one) =>
                `${one.querySelector('span')?.textContent}: ${one.querySelector('strong')?.textContent}`,
        )

    expect(lines()).toEqual([])

    click('#send')
    expect(lines()).toEqual(['billing: invoice sent'])

    // THE CLAIM. `sync` is not in `DEBUG`, so the press produces no record at all — the
    // gate is at the call rather than at the render, so nothing was built to be filtered.
    click('#poll')
    click('#poll')
    expect(lines()).toEqual(['billing: invoice sent'])

    click('#send')
    expect(lines()).toEqual(['billing: invoice sent', 'billing: invoice sent'])
})

// A WEB SOCKET ARM SERVES ITSELF TOO. `Bun.serve` is stubbed to keep the arm's `websocket`
// handlers, and the page's `WebSocket` is a stand-in wired straight to them — so a second tab is a
// second stand-in on the one captured server, holding the room id its address carries. Reverted —
// the arm's `server.publish` swapped for the sending socket's own `send` — the other tab reads the
// opening turn where the sent one was owed; reverted — every socket subscribed and published under
// one fixed topic rather than its id — the stranger reads `Sent from this tab`.
test('socket-room: a turn one tab sends reaches every tab of that browser, and no other', async () => {
    type Peer = {
        data: { id: string }
        subscribe(topic: string): void
        send(text: string): void
    }
    type Handlers = {
        open(peer: Peer): void
        message(peer: Peer, text: string): void
    }
    const topics = new Map<string, Set<Peer>>()
    let handlers: Handlers | undefined
    const serve = Bun.serve
    ;(Bun as { serve: unknown }).serve = (options: { websocket: Handlers }) => {
        handlers = options.websocket
        return {
            publish(topic: string, text: string) {
                for (const peer of topics.get(topic) ?? []) peer.send(text)
            },
        }
    }
    try {
        await import(
            `${new URL('socket-room/server.ts', ARMS_DIR).pathname}?${Math.random()}`
        )
    } finally {
        Bun.serve = serve
    }

    class TabSocket extends EventTarget {
        static OPEN = 1
        readyState = 0
        peer: Peer
        constructor(address: string) {
            super()
            const tab = this
            this.peer = {
                data: { id: new URL(address).searchParams.get('id') ?? '' },
                subscribe(topic) {
                    const peers = topics.get(topic) ?? new Set<Peer>()
                    peers.add(tab.peer)
                    topics.set(topic, peers)
                },
                send(text) {
                    tab.dispatchEvent(
                        new MessageEvent('message', { data: text }),
                    )
                },
            }
            queueMicrotask(() => {
                this.readyState = TabSocket.OPEN
                this.dispatchEvent(new Event('open'))
                handlers?.open(this.peer)
            })
        }
        send(text: string): void {
            handlers?.message(this.peer, text)
        }
    }
    function said(tab: TabSocket): () => string {
        let latest = ''
        tab.addEventListener('message', (event) => {
            latest = JSON.parse(String((event as MessageEvent).data)).text
        })
        return () => latest
    }
    const standing = globalThis.WebSocket
    globalThis.WebSocket = TabSocket as unknown as typeof WebSocket
    // biome-ignore lint/suspicious/noDocumentCookie: the browser's id, as a second tab finds it.
    document.cookie = 'room=reader-1; Path=/'
    try {
        const otherTab = said(new TabSocket('ws://docs.test/room?id=reader-1'))
        const stranger = said(new TabSocket('ws://docs.test/room?id=reader-2'))

        await mount('socket-room', 'room.js')
        await Bun.sleep(5)
        const GREETING = 'Ask about any invoice here.'
        expect([read('#said'), otherTab(), stranger()]).toEqual([
            GREETING,
            GREETING,
            GREETING,
        ])

        // THE CLAIM. The sending tab paints the turn when its room sends it back, the other tab of
        // that browser is sent the same frame, and a browser with another id is sent nothing.
        type('#draft', 'Sent from this tab')
        click('#send')
        expect([
            read('#speaker'),
            read('#said'),
            otherTab(),
            stranger(),
        ]).toEqual([
            'you',
            'Sent from this tab',
            'Sent from this tab',
            GREETING,
        ])
    } finally {
        globalThis.WebSocket = standing
        // biome-ignore lint/suspicious/noDocumentCookie: clearing what this test set.
        document.cookie = 'room=; Path=/; Max-Age=0'
    }
})

test('cookies-density: the pick lands in the cookie, and the server paints it', async () => {
    try {
        await mount('cookies-density', 'contacts.js')
        expect(read('#density')).toBe('comfortable')

        click('#compact')
        expect([read('#density'), document.cookie]).toEqual([
            'compact',
            expect.stringContaining('density=compact'),
        ])

        // THE CLAIM'S SECOND HALF. A reload is painted from the request's header, so the
        // page arrives on the density picked rather than flashing the default.
        const routes = await routesOf('cookies-density', 'server.ts')
        const page =
            await // A bare header rather than a `Request`: the DOM preload's `Request` drops
            // `cookie`, a header a browser's script may not set.
            (
                await (routes['/'] as Routes[string])({
                    headers: new Map([['cookie', 'density=compact']]),
                } as unknown as Request)
            ).text()
        expect(page).toContain('<strong id="density">compact</strong>')
        expect(page).toContain('data-density="compact" aria-selected="true"')
    } finally {
        // biome-ignore lint/suspicious/noDocumentCookie: the arm writes the jar this resets.
        document.cookie = 'density=; Path=/; Max-Age=0'
    }
})

// THE ASSISTANT ARMS' ROUTES carry a method map rather than one function, and the relay keys a
// browser by a cookie it already holds. happy-dom strips `cookie` from a `Request` it builds, so the
// stub hands the route the headers it would have sent.
function serveArm(routes: Record<string, unknown>): string[] {
    const asked: string[] = []
    globalThis.fetch = Object.assign(
        async (input: string | URL, init?: RequestInit) => {
            const url = new URL(String(input), 'http://example.invalid')
            const method = init?.method ?? 'GET'
            asked.push(`${method} ${url.pathname}`)
            const route = routes[url.pathname] as
                | ((request: Request) => Response | Promise<Response>)
                | Record<
                      string,
                      (request: Request) => Response | Promise<Response>
                  >
                | undefined
            const handler =
                typeof route === 'function' ? route : route?.[method]
            if (handler === undefined) return new Response('', { status: 404 })
            const request = new Request(url, init)
            const headers = new Headers(init?.headers)
            headers.set('cookie', 'caller=reader-1')
            Object.defineProperty(request, 'headers', { value: headers })
            return handler(request)
        },
        { preconnect: () => {} },
    ) as typeof fetch
    return asked
}

function chatTurns(): string[][] {
    const turns: string[][] = []
    for (const item of document.querySelectorAll('.chat li'))
        if (!(item as HTMLElement).hidden)
            turns.push([
                item.querySelector('span')?.textContent ?? '',
                item.querySelector('p')?.textContent?.trim() ?? '',
            ])
    return turns
}

// Reverted — the arm's dispatch answering every name as a missing tool — the result line reads
// "No tool named invoiceStatus." where the handler's answer was owed.
test('assistant-tools: the call the model asks for runs the handler, and its answer is in the stream', async () => {
    serveArm(await routesOf('assistant-tools', 'server.ts'))
    await mount('assistant-tools', 'chat.js')
    click('#ask')
    await Bun.sleep(30)
    expect(chatTurns()).toEqual([
        ['you', 'Is invoice INV-4021 paid?'],
        ['tool call', 'invoiceStatus {"id":"INV-4021"}'],
        ['your handler answered', '{"id":"INV-4021","paid":true}'],
        ['assistant', 'Yes, INV-4021 is paid.'],
    ])
    expect(read('#status')).toBe('done')
})

// Reverted — `stream: true` dropped from the arm's hand-written body — the request the stand-in
// echoes no longer carries it, and nothing on the arm's side noticed.
test('claude-api: the request body is the fields written, with messages and stream beside them', async () => {
    const asked = serveArm(await routesOf('claude-api', 'server.ts'))
    await mount('claude-api', 'request.js')
    click('#ask')
    await Bun.sleep(30)
    expect(JSON.parse(read('#reply'))).toEqual({
        model: 'claude-opus-5',
        max_tokens: 1024,
        system: 'Answer questions about invoices.',
        thinking: { type: 'adaptive' },
        stream: true,
        messages: [{ role: 'user', content: 'Is invoice INV-4021 paid?' }],
    })
    expect(asked).toEqual(['POST /api/ask', 'POST /v1/messages'])
})

// Reverted — the 409 branch removed from the arm's `/api/ask` — the ask before pairing hangs on a
// turn no bridge will ever answer, and the status line stays empty.
test('claude-code: a turn is refused until a bridge pairs, then runs on that bridge', async () => {
    const routes = await routesOf('claude-code', 'server.ts')
    serveArm(routes)
    await mount('claude-code', 'bridge.js')

    click('#ask')
    await Bun.sleep(20)
    expect(read('#status')).toBe('No Claude Code is paired with this browser.')

    click('#connect')
    await Bun.sleep(20)
    const command = read('#command')
    expect(command).toMatch(/^bunx @abide\/bridge@0\.1\.0 \S+ \S+$/)
    expect((document.querySelector('#paired') as HTMLElement).hidden).toBe(true)

    // THE BRIDGE, as the reader's terminal would run it: it dials in with the code and reads turns.
    const code = command.split(' ').at(-1) ?? ''
    const relay = routes['/bridge'] as unknown as Record<
        string,
        (request: Request) => Promise<Response> | Response
    >
    const dialed = await relay.GET?.(
        new Request(`http://example.invalid/bridge?code=${code}`),
    )
    const frames = (
        dialed as Response
    ).body?.getReader() as ReadableStreamDefaultReader<Uint8Array>
    await Bun.sleep(20)
    expect([
        (document.querySelector('#paired') as HTMLElement).hidden,
        (document.querySelector('#command') as HTMLElement).hidden,
    ]).toEqual([false, true])

    click('#ask')
    await Bun.sleep(20)
    const sent = JSON.parse(
        new TextDecoder().decode((await frames.read()).value),
    ) as {
        caller: string
        turn: string
        prompt: string
    }
    expect(sent.prompt).toBe('What does an invoice record, in one sentence?')
    for (const event of [
        { type: 'text', text: 'Who owes what, ' },
        { type: 'text', text: 'and by when.' },
        { type: 'end' },
    ])
        await relay.POST?.(
            new Request('http://example.invalid/bridge', {
                method: 'POST',
                body: JSON.stringify({ ...sent, event }),
            }),
        )
    await Bun.sleep(20)
    expect([read('#status'), read('#answer')]).toEqual([
        '',
        'Who owes what, and by when.',
    ])
})

// THE SERVER-HOOK ARMS. Each one's server half is the arm, so the page's fetch is routed into the
// routes its `Bun.serve` was handed.
function routedFetch(routes: Routes): typeof fetch {
    return Object.assign(
        async (input: string, init?: RequestInit) => {
            const url = new URL(input, 'http://example.invalid')
            return (
                (await routes[url.pathname]?.(new Request(url, init))) ??
                new Response('', { status: 404 })
            )
        },
        { preconnect: () => {} },
    ) as typeof fetch
}

test('start-hook: the pool connected before the app came up', async () => {
    globalThis.fetch = routedFetch(await routesOf('start-hook', 'server.ts'))
    await mount('start-hook', 'pool.js')
    await Bun.sleep(20)
    const [connected, up] = [read('#connected'), read('#up')]
    expect(connected).not.toBe('')
    // THE CLAIM. Revert-verified: the stamp moved above the connect -> up precedes connected.
    expect(connected <= up).toBe(true)
})

test('config-coerced: the environment overrides the default, and arrives a number', async () => {
    const was = process.env.RETRIES
    try {
        process.env.RETRIES = '5'
        globalThis.fetch = routedFetch(
            await routesOf('config-coerced', 'server.ts'),
        )
        await mount('config-coerced', 'retries.js')
        await Bun.sleep(20)
        // THE CLAIM. Revert-verified: `Number` dropped from the read -> attempts "51".
        expect([read('#retries'), read('#attempts')]).toEqual(['5', '6'])

        process.env.RETRIES = 'lots'
        await mount('config-coerced', 'retries.js')
        await Bun.sleep(20)
        expect([read('#retries'), read('#attempts')]).toEqual(['3', '4'])
    } finally {
        if (was === undefined) delete process.env.RETRIES
        else process.env.RETRIES = was
    }
})

test("health-merge: the app's own field sits beside the baseline", async () => {
    globalThis.fetch = routedFetch(await routesOf('health-merge', 'server.ts'))
    await mount('health-merge', 'health.js')
    await Bun.sleep(20)
    expect([read('#version'), read('#database')]).toEqual([
        '0.0.0',
        'connected',
    ])
    expect(read('#started')).not.toBe('')
})

test('principal-resolve: the sign-in answers with a user it was handed only the id of', async () => {
    globalThis.fetch = routedFetch(
        await routesOf('principal-resolve', 'server.ts'),
    )
    await mount('principal-resolve', 'badge.js')
    expect(read('#name')).toBe('—')

    click('#grace')
    await Bun.sleep(20)
    expect([read('#sealed'), read('#name'), read('#role')]).toEqual([
        'grace',
        'Grace Hopper',
        'sales',
    ])
})

test('csp-blocked: every document carries the whole policy, with a nonce of its own', async () => {
    const routes = await routesOf('csp-blocked', 'server.ts')
    const policies: string[] = []
    for (let turn = 0; turn < 2; turn += 1) {
        const answer = await routes['/']?.(
            new Request('http://example.invalid/'),
        )
        policies.push(answer?.headers.get('content-security-policy') ?? '')
    }
    for (const policy of policies) {
        expect(policy).toContain("script-src 'self' 'nonce-")
        expect(policy).toContain("frame-ancestors 'self'")
    }
    // THE CLAIM. A nonce is per response, or it is a password printed on every page.
    expect(policies[0]).not.toBe(policies[1])

    await mount('csp-blocked', 'widget.js')
    click('#add')
    const added = document.head.querySelector(
        'script[src="https://widget.example/chat.js"]',
    )
    expect(added).not.toBeNull()
    // A DOM emulator enforces no policy, so the refusal the browser would raise is handed in.
    document.dispatchEvent(
        Object.assign(new Event('securitypolicyviolation'), {
            blockedURI: 'https://widget.example/chat.js',
            violatedDirective: 'script-src-elem',
        }),
    )
    expect(read('#refused')).toBe(
        'https://widget.example/chat.js by script-src-elem',
    )
    added?.remove()
})

test('middleware-stamp: an answer carries the header its handler never wrote', async () => {
    globalThis.fetch = routedFetch(
        await routesOf('middleware-stamp', 'server.ts'),
    )
    await mount('middleware-stamp', 'instance.js')
    click('#ask')
    await Bun.sleep(20)
    expect(read('#served')).toMatch(/^[0-9a-f]{8}$/)
})

test('trace-lines: both lines of one request carry its trace, and the next request has another', async () => {
    globalThis.fetch = routedFetch(await routesOf('trace-lines', 'server.ts'))
    await mount('trace-lines', 'sync.js')
    click('#sync')
    await Bun.sleep(200)
    const first = read('#trace')
    expect(first).toMatch(/^[0-9a-f]{32}$/)
    expect(read('#lines')).toBe(
        'contact 4021 loaded · billing told about contact 4021',
    )

    // THE CLAIM. Lines are selected by trace, so a second sync shows its own two, not four.
    click('#sync')
    await Bun.sleep(200)
    expect(read('#trace')).not.toBe(first)
    expect(read('#lines')).toBe(
        'contact 4021 loaded · billing told about contact 4021',
    )
})

test('error-report: the caller is told 500 and the tracker is told why', async () => {
    globalThis.fetch = routedFetch(await routesOf('error-report', 'server.ts'))
    await mount('error-report', 'export.js')
    await Bun.sleep(20)
    expect([read('#told'), read('#captured')]).toEqual(['—', '—'])

    click('#export')
    await Bun.sleep(400)
    expect([read('#told'), read('#captured')]).toEqual([
        '500 Internal Server Error',
        'the export worker reset the connection',
    ])
})

test('app-fetch: the wire answers with a status and a trace header', async () => {
    globalThis.fetch = routedFetch(await routesOf('app-fetch', 'server.ts'))
    await mount('app-fetch', 'answer.js')
    click('#fetch')
    await Bun.sleep(20)
    expect(read('#status')).toBe('200')
    expect(read('#traced')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/)
})

// THE EXAMPLE'S OWN TEST, run as its reader runs it: `bun test` from the docs app's directory, where
// `createApp` finds the app. Revert-verified: `onStop` with its close removed -> the second case
// fails on `connected` still true.
test('app-fetch: the test the card shows passes from the docs app', async () => {
    const { spawned } = await import('../src/gate/index.ts')
    const run = await spawned(
        // A child under a loaded gate boots the app past bun's 5 s default for a test.
        [
            process.execPath,
            'test',
            '--timeout=60000',
            './src/ship/call-your-app-from-a-test/app.test.ts',
        ],
        { cwd: DOGFOOD.pathname, deadline: 120_000 },
    )
    if (run.exitCode !== 0) console.error(run.stderr)
    expect(`${run.exitCode} ${run.stderr.includes('2 pass')}`).toBe('0 true')
}, 130_000)

// Reverted — `escapeHtml` dropped from `documentOf` — the second invoice's customer reads
// `Hopper & Co` raw where `Hopper &amp; Co` was owed.
test('render-preview: each invoice is rendered into a document of its own', async () => {
    const routes = await routesOf('render-preview', 'server.ts')
    const answer = await routes['/api/previewInvoice']?.(
        new Request('http://example.invalid/api/previewInvoice?id=4022'),
    )
    // THE CLAIM: a whole document, built from that invoice's record, escaped.
    expect(answer?.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const html = (await answer?.text()) ?? ''
    expect(html).toStartWith('<!doctype html>')
    expect(html).toContain('<h1>Invoice INV-4022</h1>')
    expect(html).toContain('Hopper &amp; Co')

    // The page is a frame pointed at that route, and the tab moves it. Read off the attribute
    // rather than loaded: happy-dom would fetch the frame against a server this spec never started.
    await mount('render-preview', 'invoice.js')
    const frame = () => document.querySelector('#preview')?.getAttribute('src')
    expect(frame()).toBe('/api/previewInvoice?id=4021')
    click('#inv-4022')
    expect(frame()).toBe('/api/previewInvoice?id=4022')
})
