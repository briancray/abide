// 44.67-44.74 — `pairing`, a browser's pairing with a Claude Code bridge and the click that pairs one,
// over `/__abide/pairing`. The browser half runs against a `fetch` that answers the statuses a test
// pushes, a `location.assign` that records the link, and fake timers, so a blur and the wait are the
// test's to decide.

import { afterEach, beforeEach, expect, jest, spyOn, test } from 'bun:test'

import { GET } from '#server'
import { PAIRING_ADDRESS } from '#shared/ADDRESSES.ts'
import type { BridgeStatus } from '#shared/BridgeStatus.ts'
import { pairing } from '#shared/pairing.ts'
import { collectWatches } from '#shared/reactive/watch.ts'
import { RPC_SERVER } from '#shared/RPC_SERVER.ts'

import { inMemoryApp } from './inMemoryApp.ts'

const LINK = 'abide-bridge://pair?code=one'
const UNPAIRED: BridgeStatus = {
    paired: false,
    missing: [],
    command: 'bunx @abide/bridge@1.0.0 http://site one',
    link: LINK,
    install: 'bunx @abide/bridge@1.0.0 install',
}

let push: (status: BridgeStatus) => void = () => {}
let asked: { url: string; signal: AbortSignal | undefined }[] = []
const realFetch = globalThis.fetch

beforeEach(() => {
    asked = []
    // `/__abide/pairing` answering one jsonl line per status the test pushes.
    globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
    ) => {
        asked.push({
            url: String(input),
            signal: init?.signal ?? undefined,
        })
        const encoder = new TextEncoder()
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                push = (status) =>
                    controller.enqueue(
                        encoder.encode(`${JSON.stringify(status)}\n`),
                    )
                init?.signal?.addEventListener('abort', () =>
                    controller.error(init.signal?.reason),
                )
            },
        })
        return new Response(body, {
            headers: { 'content-type': 'application/jsonl' },
        })
    }) as typeof fetch
    spyOn(location, 'assign').mockImplementation(() => {})
})

/** A clipboard that records into `written` what is written to it, until the test ends. */
function clipboardWrites(written: string[]): void {
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
            writeText: async (text: string) => {
                written.push(text)
            },
        },
    })
}

afterEach(() => {
    // The DOM's own clipboard, an accessor on the prototype, again.
    delete (navigator as { clipboard?: unknown }).clipboard
    globalThis.fetch = realFetch
    jest.useRealTimers()
    jest.restoreAllMocks()
})

/** A `pairing` built as a component's setup builds one, with the stops its dispose runs. */
function built(tools?: string[]): {
    pair: ReturnType<typeof pairing>
    dispose: () => void
} {
    const stops: (() => void)[] = []
    const previous = collectWatches(stops)
    const pair = pairing(tools === undefined ? {} : { tools })
    collectWatches(previous)
    return { pair, dispose: () => stops.forEach((stop) => stop()) }
}

/** Pushes `status`, and waits for `pair.status` to hold it. */
async function landed(
    pair: ReturnType<typeof pairing>,
    status: BridgeStatus,
): Promise<void> {
    push(status)
    for (let turn = 0; turn < 50; turn++) {
        await Promise.resolve()
        await new Promise((done) => queueMicrotask(() => done(undefined)))
        if (pair.status.ready() && pair.status()?.link === status.link) return
    }
    await Bun.sleep(1)
    expect(pair.status()).toEqual(status)
}

test('reads the browser’s pairing off /__abide/pairing, asking for its tools — 44.70', async () => {
    const { pair, dispose } = built(['WebSearch', 'WebFetch'])
    await landed(pair, UNPAIRED)
    expect(pair.status()).toEqual(UNPAIRED)
    expect(asked[0]?.url).toBe(`${PAIRING_ADDRESS}?tools=WebSearch%2CWebFetch`)
    dispose()
})

test('a click that blurs the page offers the click again; one that does not offers the install — 44.71, 44.72', async () => {
    const { pair, dispose } = built()
    // No status yet: nothing to open.
    pair.start()
    expect(pair.step()).toBe('click')
    await landed(pair, UNPAIRED)
    jest.useFakeTimers()
    pair.start()
    expect(pair.step()).toBe('waiting')
    expect(location.assign).toHaveBeenCalledWith(LINK)
    dispatchEvent(new Event('blur'))
    jest.advanceTimersByTime(2500)
    expect(pair.step()).toBe('click')
    pair.start()
    jest.advanceTimersByTime(2499)
    expect(pair.step()).toBe('waiting')
    jest.advanceTimersByTime(1)
    expect(pair.step()).toBe('install')
    dispose()
})

test('a click with a bridge already paired offers the click again — 44.72', async () => {
    const { pair, dispose } = built()
    await landed(pair, { ...UNPAIRED, paired: true })
    jest.useFakeTimers()
    pair.start()
    jest.advanceTimersByTime(2500)
    expect(pair.step()).toBe('click')
    dispose()
})

test('copyInstall copies the install command and holds copied — 44.73', async () => {
    const { pair, dispose } = built()
    await landed(pair, UNPAIRED)
    const written: string[] = []
    clipboardWrites(written)
    jest.useFakeTimers()
    pair.start()
    jest.advanceTimersByTime(2500)
    expect(pair.step()).toBe('install')
    await pair.copyInstall()
    expect(written).toEqual([UNPAIRED.install])
    expect(pair.copied()).toBe(true)
    jest.advanceTimersByTime(1200)
    expect(`${pair.copied()} ${pair.step()}`).toBe('false click')
    dispose()
})

// 44.74 — A DISPOSED PAIRING LEAVES NOTHING RUNNING: its read of `/__abide/pairing`, the blur listener a
// click added and the timers a click and a copy set — asserted by what the timers would have written,
// since bun's `jest.getTimerCount` still counts a cleared one. THE REVERT: drop the `owned(…)` call in
// `pairing.ts`; this reports `blur listeners: 1, step: install, copied: false, read aborted: false`.
test('dispose stops the read and clears the blur listener and both timers — 44.74', async () => {
    const { pair, dispose } = built()
    await landed(pair, UNPAIRED)
    clipboardWrites([])
    let listening = 0
    const add = window.addEventListener.bind(window)
    const remove = window.removeEventListener.bind(window)
    spyOn(window, 'addEventListener').mockImplementation(((
        type: string,
        listener: EventListener,
        options?: AddEventListenerOptions,
    ) => {
        if (type === 'blur') listening += 1
        add(type, listener, options)
    }) as typeof window.addEventListener)
    spyOn(window, 'removeEventListener').mockImplementation(((
        type: string,
        listener: EventListener,
    ) => {
        if (type === 'blur') listening -= 1
        remove(type, listener)
    }) as typeof window.removeEventListener)
    jest.useFakeTimers()
    pair.start()
    await pair.copyInstall()
    expect(`${listening} ${pair.step()} ${pair.copied()}`).toBe(
        '1 waiting true',
    )
    dispose()
    const listeningAfter = listening
    // Past both waits: a timer left standing would have moved `step` and `copied` by now.
    jest.advanceTimersByTime(5000)
    expect(
        `blur listeners: ${listeningAfter}, step: ${pair.step()}, copied: ${pair.copied()}, read aborted: ${asked[0]?.signal?.aborted}`,
    ).toBe('blur listeners: 0, step: waiting, copied: true, read aborted: true')
})

test('/__abide/pairing answers the asking browser’s pairing, granting its tools — 44.67', async () => {
    await using app = await inMemoryApp({})
    const watching = new AbortController()
    const answer = await app.fetch(
        new Request(`http://site${PAIRING_ADDRESS}?tools=WebSearch,WebFetch`, {
            headers: { accept: 'application/jsonl' },
            signal: watching.signal,
        }),
        { caller: 'one-browser' },
    )
    expect(answer.status).toBe(200)
    const reader = (answer.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let read = ''
    while (!read.includes('\n'))
        read += decoder.decode((await reader.read()).value)
    watching.abort()
    await reader.cancel().catch(() => {})
    const status = JSON.parse(read.split('\n')[0] as string) as BridgeStatus
    expect(status.paired).toBe(false)
    expect(status.command).toEndWith(' -- --tools WebSearch,WebFetch')
    expect(new URL(status.link).searchParams.get('tools')).toBe(
        'WebSearch,WebFetch',
    )
})

// 44.69 — A PAIRING IDLES PAST AN OPERATOR'S `ABIDE_RPC_TIMEOUT`. THE REVERT: drop `timeout: Infinity`
// from the handler in `claudeCode.ts`; the stream is refused at the timeout and this reports `504`.
test('/__abide/pairing outlives ABIDE_RPC_TIMEOUT — 44.69', async () => {
    await using app = await inMemoryApp({})
    const configured = RPC_SERVER.timeout
    RPC_SERVER.timeout = () => 20
    try {
        const watching = new AbortController()
        const answer = await app.fetch(
            new Request(`http://site${PAIRING_ADDRESS}`, {
                headers: { accept: 'application/jsonl' },
                signal: watching.signal,
            }),
            { caller: 'idle-browser' },
        )
        const reader = (answer.body as ReadableStream<Uint8Array>).getReader()
        const decoder = new TextDecoder()
        let read = ''
        while (!read.includes('\n'))
            read += decoder.decode((await reader.read()).value)
        const after = await Promise.race([
            reader.read().then(
                (next) =>
                    next.done ? 'ended' : decoder.decode(next.value).trim(),
                () => 'ended',
            ),
            Bun.sleep(200).then(() => 'open'),
        ])
        watching.abort()
        await reader.cancel().catch(() => {})
        expect(after).toBe('open')
    } finally {
        RPC_SERVER.timeout = configured
    }
})

test('/__abide/pairing is on no generated surface — 44.68', async () => {
    // One handler of the app's own, so the surfaces have something to list.
    await using app = await inMemoryApp({
        'contacts.handler.ts': { default: GET(() => ['Ada']) },
    })
    const listed = (await (
        await app.fetch(
            new Request('http://site/__abide/mcp', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/list',
                    params: {},
                }),
            }),
        )
    ).json()) as { result: { tools: { name: string }[] } }
    expect(listed.result.tools.map((tool) => tool.name)).toEqual([
        'get_contacts',
    ])
    const document = (await (
        await app.fetch(new Request('http://site/__abide/openapi.json'))
    ).json()) as { paths: Record<string, unknown> }
    expect(Object.keys(document.paths)).toEqual(['/contacts'])
})
