// 44.67-44.75 — `pairing`, a browser's pairing with a Claude Code bridge and the click that pairs one,
// over `/__abide/pairing`. The browser half runs against a `fetch` that answers the status a test
// pushed last, a mux whose refresh a push sends, a `location.assign` that records the link, and fake
// timers, so a blur and the wait are the test's to decide.

import { afterEach, beforeEach, expect, jest, spyOn, test } from 'bun:test'

import { GET } from '#server'
import { config } from '#server/config.ts'
import { PAIRING_ADDRESS } from '#shared/ADDRESSES.ts'
import type { BridgeStatus } from '#shared/BridgeStatus.ts'
import { MUX_FOLLOWS } from '#shared/MUX_FOLLOWS.ts'
import { pairing } from '#shared/pairing.ts'
import { collectWatches } from '#shared/reactive/watch.ts'

import { inMemoryApp } from './inMemoryApp.ts'

const LINK = 'abide-bridge://pair?code=one'
const UNPAIRED: BridgeStatus = {
    paired: false,
    missing: [],
    command: 'bunx @abide/bridge@1.0.0 http://site one',
    link: LINK,
    install: 'bunx @abide/bridge@1.0.0 install',
}

// What `/__abide/pairing` answers next, the copy the mux would refresh, and how often it was unfollowed.
let answering: BridgeStatus = UNPAIRED
let followed: (() => unknown) | undefined
let unfollowed = 0
let asked: { url: string; signal: AbortSignal | undefined }[] = []
const realFetch = globalThis.fetch

beforeEach(() => {
    asked = []
    answering = UNPAIRED
    followed = undefined
    unfollowed = 0
    // `/__abide/pairing` answering the status a test last pushed, once per read.
    globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
    ) => {
        asked.push({
            url: String(input),
            signal: init?.signal ?? undefined,
        })
        return Response.json(answering)
    }) as typeof fetch
    // 18.36 — the mux's browser half: a pushed status is the refresh it would be sent.
    MUX_FOLLOWS.follow = (_address, _args, _version, _life, entry) => {
        followed = entry
    }
    MUX_FOLLOWS.unfollow = () => {
        unfollowed += 1
    }
    spyOn(location, 'assign').mockImplementation(() => {})
})

/** What `/__abide/pairing` answers from now, and the refresh the mux sends where it is followed. */
function push(status: BridgeStatus): void {
    answering = status
    ;(followed?.() as { refresh(): void } | undefined)?.refresh()
}

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
    MUX_FOLLOWS.follow = null
    MUX_FOLLOWS.unfollow = null
    jest.useRealTimers()
    jest.restoreAllMocks()
})

/** A `pairing` built as a component's setup builds one, with the stops its dispose runs. */
function built(): {
    pair: ReturnType<typeof pairing>
    dispose: () => void
} {
    const stops: (() => void)[] = []
    const previous = collectWatches(stops)
    const pair = pairing()
    collectWatches(previous)
    return { pair, dispose: () => stops.forEach((stop) => stop()) }
}

/** Pushes `status`, and waits for `pair.status` to hold it. */
async function landed(
    pair: ReturnType<typeof pairing>,
    status: BridgeStatus,
): Promise<void> {
    // Pushed once the first read is followed: before, the read in flight answers what stood.
    if (answering !== status) {
        for (let turn = 0; turn < 50 && followed === undefined; turn++)
            await Bun.sleep(0)
        push(status)
    }
    for (let turn = 0; turn < 50; turn++) {
        await Promise.resolve()
        await new Promise((done) => queueMicrotask(() => done(undefined)))
        if (
            pair.status.ready() &&
            pair.status()?.link === status.link &&
            pair.status()?.paired === status.paired
        )
            return
    }
    await Bun.sleep(1)
    expect(pair.status()).toEqual(status)
}

test('reads the browser’s pairing off /__abide/pairing, naming no tools — 44.70', async () => {
    const { pair, dispose } = built()
    await landed(pair, UNPAIRED)
    expect(pair.status()).toEqual(UNPAIRED)
    expect(asked[0]?.url).toBe(PAIRING_ADDRESS)
    dispose()
})

// 44.69 — READ ONCE AND FOLLOWED: a pairing that changes is read again when the mux says so, and two
// `pairing` on one page share the one read and the one follow. THE REVERT: skip `MUX_FOLLOWS.follow`
// in `pairing.ts`; the pushed status never lands and `landed` reports the unpaired one.
test('a pairing is read again when its follow is refreshed, one read for every reader — 44.69', async () => {
    const one = built()
    const two = built()
    await landed(one.pair, UNPAIRED)
    expect(two.pair.status()).toEqual(UNPAIRED)
    expect(asked).toHaveLength(1)
    await landed(one.pair, { ...UNPAIRED, paired: true })
    expect(two.pair.status()?.paired).toBe(true)
    expect(asked).toHaveLength(2)
    one.dispose()
    expect(unfollowed).toBe(0)
    two.dispose()
    expect(unfollowed).toBe(1)
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

// 44.74 — A DISPOSED PAIRING LEAVES NOTHING RUNNING: its read of `/__abide/pairing` and its follow, the
// blur listener a click added and the timers a click and a copy set — asserted by what the timers
// would have written, since bun's `jest.getTimerCount` still counts a cleared one. THE REVERT: drop
// the `owned(…)` call in `pairing.ts`; this reports `blur listeners: 1, step: install, copied: false,
// read aborted: false, unfollowed: 0`.
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
        `blur listeners: ${listeningAfter}, step: ${pair.step()}, copied: ${pair.copied()}, read aborted: ${asked[0]?.signal?.aborted}, unfollowed: ${unfollowed}`,
    ).toBe(
        'blur listeners: 0, step: waiting, copied: true, read aborted: true, unfollowed: 1',
    )
})

/** The status `/__abide/pairing` answers the browser `caller` at `query`, with `tools` declared. */
async function firstStatus(
    caller: string,
    query: string,
    tools: string | undefined,
): Promise<BridgeStatus> {
    const declared = process.env.ABIDE_BRIDGE_TOOLS
    if (tools === undefined) delete process.env.ABIDE_BRIDGE_TOOLS
    else process.env.ABIDE_BRIDGE_TOOLS = tools
    config.invalidate()
    try {
        await using app = await inMemoryApp({})
        const answer = await app.fetch(
            new Request(`http://site${PAIRING_ADDRESS}${query}`),
            { caller },
        )
        expect(answer.status).toBe(200)
        return (await answer.json()) as BridgeStatus
    } finally {
        if (declared === undefined) delete process.env.ABIDE_BRIDGE_TOOLS
        else process.env.ABIDE_BRIDGE_TOOLS = declared
        config.invalidate()
    }
}

/** What a status's command and link grant, as one line. */
function granted(status: BridgeStatus): string {
    const tools = new URL(status.link).searchParams.get('tools')
    return `command: ${status.command.split(' -- ')[1] ?? 'no grant'}, link: ${tools ?? 'no tools'}`
}

test('/__abide/pairing answers the asking browser’s pairing, granting ABIDE_BRIDGE_TOOLS — 44.67', async () => {
    const status = await firstStatus('one-browser', '', 'WebSearch,WebFetch')
    expect(status.paired).toBe(false)
    expect(granted(status)).toBe(
        'command: --tools WebSearch,WebFetch, link: WebSearch,WebFetch',
    )
    expect(granted(await firstStatus('two-browser', '', undefined))).toBe(
        'command: no grant, link: no tools',
    )
})

// 44.75 — THE TOOLS ARE THE SERVER'S TO DECIDE: a request naming some is granted none of them. THE
// REVERT: have the handler in `claudeCode.ts` split `args.tools` into `bridge`'s `tools` again; this
// reports `command: --tools WebSearch, link: WebSearch`.
test('/__abide/pairing grants no tool a request names — 44.75', async () => {
    const status = await firstStatus(
        'asking-browser',
        '?tools=WebSearch',
        undefined,
    )
    expect(granted(status)).toBe('command: no grant, link: no tools')
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
