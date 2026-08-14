// The reload client, RUN rather than read.
//
// Every claim here failed silently in a real browser: the page renders, the server is fine, the
// console is empty, and the only symptom is a tab that stops keeping up with the files. So the
// assertions are about WORK — which sockets were opened, whether the id was asked for, whether the
// page was reloaded — and never about output.
//
// The string under test is the one that ships. It is a classic script, so its free identifiers
// resolve lexically: handing them in as parameters is a whole browser's worth of substitution
// without a browser, and without touching a global anything else in the suite can see.

import { expect, test } from 'bun:test'
import { useMountBase } from '$shared/internal/mount.ts'
import { BOOT_ID, reloadClient, reloadSource, reloadTag } from './reload.ts'

/** What the client does to a socket, from the socket's side. */
interface Stub {
    onopen: (() => void) | null
    onclose: (() => void) | null
    closed: boolean
}

/** A page with this client in it, stopped in time. Nothing runs until a case says so. */
interface Page {
    sockets: Stub[]
    /** Pending `setTimeout` callbacks, oldest first — the backoff, without waiting for it. */
    timers: Array<() => void>
    fetches: number
    reloads: number
    /** What the server answers `?boot` with. A case moves it to restart the server. */
    serving: string
}

/**
 * Run the client as a page whose document carries `documentId`.
 *
 * `fails` is the transient network error that mattered: the socket is up, so nothing will close it
 * and nothing will re-ask, which is how one failed check used to strand a page permanently.
 */
function load(documentId: string, serving: string, fails = false): Page {
    const page: Page = { sockets: [], timers: [], fetches: 0, reloads: 0, serving }

    class Socket implements Stub {
        onopen: (() => void) | null = null
        onclose: (() => void) | null = null
        closed = false
        constructor() {
            page.sockets.push(this)
        }
        close(): void {
            this.closed = true
            this.onclose?.()
        }
    }

    const document = { currentScript: { src: `http://app.test/__abide/reload.js?${documentId}` } }
    const location = {
        protocol: 'http:',
        host: 'app.test',
        reload: (): void => {
            page.reloads++
        },
    }
    const fetch = (): Promise<{ text: () => Promise<string> }> => {
        page.fetches++
        return fails ? Promise.reject(new TypeError('Load failed')) : Promise.resolve({ text: async () => page.serving })
    }
    const setTimeout = (run: () => void): number => page.timers.push(run)

    new Function('document', 'location', 'WebSocket', 'fetch', 'setTimeout', reloadSource())(
        document,
        location,
        Socket,
        fetch,
        setTimeout,
    )
    return page
}

/** The client's own work is promise-chained, so a case has to let the microtasks drain. */
const settled = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
}

// The three things a case DOES to this client, named. Every one of them is an index into a list the
// checker will not narrow, so written inline they are a cast wider than the thing being said — and
// what a case is doing is the whole of what these tests are about.
const socketAt = (page: Page, at = 0): Stub => page.sockets[at] as Stub
const open = (page: Page, at = 0): void => socketAt(page, at).onopen?.()
const close = (page: Page, at = 0): void => socketAt(page, at).onclose?.()
/** Let the backoff fire, without waiting for it. */
const backoff = (page: Page): void => (page.timers.shift() as () => void)()

const BOOTED = '019ffbe9-0000-7000-0000-000000000001'
const RESTARTED = '019ffbe9-0000-7000-0000-000000000002'

test('the check runs on the FIRST successful open, not only on a reconnect', async () => {
    // The shape that stranded a page for as long as it was left open, and the reason it is not
    // exotic: the document came from a worker that was already being replaced, so the socket its own
    // client opens is refused. Nothing about this page is broken — it just never asks.
    const page = load(BOOTED, BOOTED)
    expect(page.sockets).toHaveLength(1)
    close(page)
    expect(page.fetches).toBe(0)

    // The backoff brings it back up, and by now a NEW worker is the one answering.
    page.serving = RESTARTED
    expect(page.timers).toHaveLength(1)
    backoff(page)
    expect(page.sockets).toHaveLength(2)

    // The first open this page ever completes, and the one moment it can notice. A `seen` flag that
    // exempted it left the socket healthy from here on — so `onclose` never fires again, the retry
    // never runs again, and this is the last chance there was.
    open(page, 1)
    await settled()
    expect(page.fetches).toBe(1)
    expect(page.reloads).toBe(1)
})

test('a page whose server never moved is left alone', async () => {
    // The other half, and the reason the id exists at all: a slept laptop, a proxy timeout or a
    // browser reclaiming an idle socket all close a connection against a server that is still there.
    // Reloading on the reconnect alone threw away whatever the page was doing.
    const page = load(BOOTED, BOOTED)
    open(page)
    await settled()
    expect(page.fetches).toBe(1)
    expect(page.reloads).toBe(0)
    close(page)
    backoff(page)
    open(page, 1)
    await settled()
    expect(page.fetches).toBe(2)
    expect(page.reloads).toBe(0)
})

test('a check that fails closes the socket, because nothing else would ask again', async () => {
    // Seen in a real trace: the reconnect landed, the fetch raced the restart and lost, and the
    // rejection was swallowed. The socket was open and healthy from then on, so there was no close
    // to trigger the backoff and no second attempt — one lost request, stale forever.
    const page = load(BOOTED, RESTARTED, true)
    open(page)
    await settled()
    expect(page.fetches).toBe(1)
    expect(page.reloads).toBe(0)
    expect(socketAt(page).closed).toBe(true)
    // Closing is what puts it back on the one recovery path there is.
    expect(page.timers).toHaveLength(1)
})

test('the id compared is the one the DOCUMENT carries, not this module’s own', async () => {
    // A page whose own load was severed fetches this script from whatever worker is up NEXT. An id
    // baked into the script would be that worker's, so a stale page would compare itself against the
    // server serving it, find them equal, and conclude it was current.
    //
    // The pair is what distinguishes the two, and NEITHER id here is this module's: what decides has
    // to be the document's, so the same server must leave one page alone and reload the other. One
    // case on its own cannot tell them apart — a baked id reloads whenever the server has moved on
    // from THIS module, which is right by accident exactly half the time.
    const current = load(BOOTED, BOOTED)
    open(current)
    await settled()
    expect(current.reloads).toBe(0)

    const stale = load(BOOTED, RESTARTED)
    open(stale)
    await settled()
    expect(stale.reloads).toBe(1)

    // And the tie to the head: the tag is where a page gets that id, so a client reading somewhere
    // else — or a tag that stopped writing it — is a page that cannot tell either way.
    const src = /src="([^"]+)"/.exec(reloadTag())?.[1] as string
    expect(src).toContain(`?${BOOT_ID}`)
})

test('the client runs on ARRIVAL, so a document that never finishes parsing still reconnects', () => {
    // The stuck tab in the report: a document severed mid-body never finishes parsing and sits on
    // `readyState: 'loading'`. A deferred script waits for a parse that is never coming, so the one
    // page that needs this client is the one page it never runs on.
    expect(reloadTag()).toContain('<script async ')
    expect(reloadTag()).not.toContain('defer')
})

test('under a mount, this route is the mounted address and NOT the origin root', async () => {
    // The address is the one claim about this route a rendering page cannot make: a dev client served
    // at the origin root of an app mounted at `/v2` looks fine — it is the same bytes — while the
    // bundle route beside it correctly refuses that address. Two routes of one dev server disagreeing
    // about where the app is, silently.
    //
    // Module-global, so it is put back: every other case in this file is written at the root.
    useMountBase('http://app.test/v2')
    try {
        const mounted = reloadClient(new Request('http://app.test/v2/__abide/reload.js'), 'source')
        expect(mounted?.status).toBe(200)

        // `unmounted` hands a path outside the mount back UNCHANGED, so this used to still read as the
        // reload path and be answered here.
        const atRoot = reloadClient(new Request('http://app.test/__abide/reload.js'), 'source')
        expect(atRoot).toBeUndefined()

        // The boot id moves with it, or a page under the mount asks an address nothing answers.
        const asking = reloadClient(new Request('http://app.test/v2/__abide/reload.js?boot'), 'source')
        expect(await asking?.text()).toBe(BOOT_ID)
    } finally {
        useMountBase('')
    }
})

test('a request for this file that is not a page concludes nothing', () => {
    // `reloadClient` answers a bare request too, and a script with no id to compare against must not
    // read "" as a mismatch and reload — which is a tab reloading itself forever.
    const page = load('', BOOTED)
    expect(page.sockets).toHaveLength(0)
})
