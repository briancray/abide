// A client-side navigation, end to end: the server's fragment into the client's sink.
//
// Not a demo, for the reason `pages.test.ts` is not one. A demo case runs the SAME body headless and
// inside a browser card, and this body drives the document's own router — outside an `isolate`, which
// is the only way the navigation sink is reached at all (`navigate` consults it only when there is no
// caller scope). In a card that would move the site's address bar and re-render the page the card is
// sitting on, out from under itself. So it runs here, where the document is the emulator's.
//
// The fixture is the SERVER's, not a hand-written string: `renderFragment` is the generator that
// answers a real navigation, so what these tests feed the client is what a client actually receives —
// placeholders, patches, sentinels and all. `start.test.ts` asserts the same shape off the wire of a
// spawned process; this asserts what the other half does with it. Neither writes the format down.
//
// What is counted rather than eyeballed: how many times a page view runs, and whether the nodes on
// screen after the stream ends are the ones the first piece put there. Both are work claims — a
// navigation that rebuilt what it was handed renders exactly the same page, and only the node
// identity says which one happened.

import { afterEach, beforeAll, expect, test } from 'bun:test'
import {
    html,
    isolate,
    type Loader,
    navigate,
    outlet,
    type RouteEntry,
    route,
    routes,
    suspend,
    type View,
} from 'abide'
import { renderFragment } from 'abide/server'
import { container, sweepContainers, until } from 'abide/tests'
import { mount } from 'abide/ui'

const NAVIGATION_HEADER = 'x-abide-navigation'

/** A view that is already here, as a loader — the same shape `() => import('./page.abide')` has. */
function load(view: View): Loader {
    return () => ({ default: view })
}

/**
 * The panel a page defers, as a promise the test settles by hand.
 *
 * A `suspend` is what puts a PLACEHOLDER in the first piece and a patch behind it, which is the half
 * of the protocol a document gets for free from its inline script and a fragment has to do itself.
 */
interface Deferred {
    promise: Promise<string>
    settle: (value: string) => void
}

function deferred(): Deferred {
    let settle: (value: string) => void = () => undefined
    const promise = new Promise<string>((resolve) => {
        settle = resolve
    })
    return { promise, settle }
}

let panel = deferred()
let userRuns = 0

const Home: View = () => html`<b>home</b>`

const User: View = () => {
    userRuns++
    return html`<b>user ${() => route().params.id}</b>${suspend(
        panel.promise,
        (settled: string) => html`<i>${settled}</i>`,
        html`<em>loading</em>`,
    )}`
}

/** Three deferred subtrees on one page, so a patch has siblings to be found among. */
const Panels: View = () =>
    html`<b>panels</b>${suspend(panel.promise, (s: string) => html`<i>${s}</i>`, html`<em>one</em>`)}${suspend(
        panel.promise,
        (s: string) => html`<i>${s}</i>`,
        html`<em>two</em>`,
    )}${suspend(panel.promise, (s: string) => html`<i>${s}</i>`, html`<em>three</em>`)}`

const TABLE: RouteEntry[] = [
    { path: '/', page: load(Home) },
    { path: '/users/[id]', page: load(User) },
    { path: '/panels', page: load(Panels) },
]

/**
 * The bytes a server would answer a navigation to `path` with, in the order it writes them.
 *
 * Rendered inside an `isolate` so it commits nothing against the caller the tests below drive — this
 * is the SERVER's caller, standing at the target URL, which is exactly what it is on a real request.
 */
async function fragmentFor(path: string, settledPanel: string): Promise<string[]> {
    const held = panel
    panel = deferred()
    panel.settle(settledPanel)
    try {
        return await isolate(async () => {
            await navigate(path)
            const pieces: string[] = []
            for await (const chunk of renderFragment(() => outlet(), { hydratable: true })) {
                pieces.push(chunk)
            }
            return pieces
        })
    } finally {
        panel = held
    }
}

/**
 * The sentinel a fragment frames its pieces with.
 *
 * Written down rather than imported, because `$shared/internal/MARKERS.ts` owns it and an app is not
 * entitled to reach in there — this file is the example, and it holds itself to what an app can do.
 * The copy is safe in the direction that matters: the fixture comes from `renderFragment`, so a
 * renamed sentinel is a cut that lands nowhere and fails these tests loudly rather than silently.
 */
const PIECE_END = '<!--abide:piece-->'

interface Asked {
    url: string
    headers: Headers
    credentials: RequestCredentials | undefined
    redirect: RequestRedirect | undefined
}

let asked: Asked | null = null
let release: () => void = () => undefined
const REAL_FETCH = globalThis.fetch

/**
 * Answer the next navigation with `pieces`, holding everything after the first one back.
 *
 * The gate is the point: a fragment's first piece is the whole page bar its deferred panels, and the
 * claim is that it is ON SCREEN before the rest of the response exists. A stub that wrote the whole
 * body at once could not tell that apart from a navigation that waits for the slowest panel on it.
 */
function answerWith(pieces: string[], options?: { ok?: boolean; header?: boolean }): void {
    asked = null
    const gate = new Promise<void>((resolve) => {
        release = resolve
    })
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        asked = {
            url: String(input),
            headers: new Headers(init?.headers),
            credentials: init?.credentials,
            redirect: init?.redirect,
        }
        const whole = pieces.join('')
        const cut = whole.indexOf(PIECE_END) + PIECE_END.length
        const body = new ReadableStream<Uint8Array>({
            async start(controller) {
                const encoder = new TextEncoder()
                controller.enqueue(encoder.encode(whole.slice(0, cut)))
                await gate
                if (cut < whole.length) controller.enqueue(encoder.encode(whole.slice(cut)))
                controller.close()
            },
        })
        const headers = new Headers()
        if (options?.header !== false) headers.set(NAVIGATION_HEADER, '1')
        return new Response(body, { status: options?.ok === false ? 500 : 200, headers })
    }) as typeof fetch

    // A refusal never opens the gate — nothing is coming — so it is released up front.
    if (options?.ok === false || options?.header === false) release()
}

/**
 * A document with a PLACE, which the emulator does not give one by default.
 *
 * `about:blank` is what `DocumentHistory.href()` deliberately reports as "nowhere", and `pushState`
 * refuses it outright — so a navigation driven against the real address bar cannot run at all until
 * this document has an origin. Set here rather than in the shared preload: every other suite drives
 * routing inside an `isolate`, where the caller's URL comes from `navigate` and the address bar is
 * never touched, and giving all of them an address would hide exactly the case they avoid.
 */
beforeAll(() => {
    const emulator = (globalThis as unknown as { happyDOM?: { setURL?: (url: string) => void } }).happyDOM
    emulator?.setURL?.('http://localhost/')
    routes(TABLE)
})

afterEach(() => {
    globalThis.fetch = REAL_FETCH
    sweepContainers()
    panel = deferred()
})

test('a navigation asks the server at the TARGET url, as the document that is asking', async () => {
    const pieces = await fragmentFor('/users/1', 'the panel')
    answerWith(pieces)
    const view = mount(container(), outlet)
    try {
        const navigating = navigate('/users/1')
        await until(() => asked !== null, 'the request')
        release()
        await navigating

        const seen = asked as unknown as Asked
        // The target itself, not an endpoint under `/__abide/`: the request carries the path the
        // reader is navigating to, so the app's middleware onion runs around it exactly once and
        // sees what it would have seen for a full page load.
        expect(new URL(seen.url).pathname).toBe('/users/1')
        expect(seen.headers.get(NAVIGATION_HEADER)).toBe('1')
        // The cookies are the whole point — the auth rung reads the same seal a page load would.
        expect(seen.credentials).toBe('same-origin')
        // Followed, so a rung that redirects to a login page has that page rendered rather than
        // costing a second round trip to discover.
        expect(seen.redirect).toBe('follow')
    } finally {
        view.dispose()
    }
})

test('the first piece is on screen before the rest of the response exists', async () => {
    const pieces = await fragmentFor('/users/2', 'the panel')
    answerWith(pieces)
    const into = container()
    const view = mount(into, outlet)
    try {
        const navigating = navigate('/users/2')
        await until(() => into.textContent?.includes('user 2') === true, 'the first piece')

        // The page is up and the deferred panel is still its FALLBACK, with the rest of the response
        // not yet written. This is the difference between a navigation that waits for the slowest
        // thing on the page and one that waits for the fastest.
        expect(into.textContent).toContain('user 2')
        expect(into.textContent).toContain('loading')
        expect(into.textContent).not.toContain('the panel')

        release()
        await navigating
        // And the patch landed in the placeholder the first piece left standing.
        expect(into.textContent).toContain('the panel')
        expect(into.textContent).not.toContain('loading')
    } finally {
        view.dispose()
    }
})

test('the range is ADOPTED when the stream ends, not rebuilt over', async () => {
    const pieces = await fragmentFor('/users/3', 'the panel')
    answerWith(pieces)
    const into = container()
    const view = mount(into, outlet)
    try {
        const navigating = navigate('/users/3')
        await until(() => into.textContent?.includes('user 3') === true, 'the first piece')

        // The node the SERVER's markup put on screen, and the count of how many there are.
        //
        // Identity alone is not enough, and the way it fails is the reason: the range the stream
        // filled is not `owned` by the part, so a commit that rebuilt instead of claiming does not
        // REPLACE these nodes — it inserts a second copy beside them and leaves the first one
        // connected. The page then reads as a duplicate rather than as a rebuild, and an identity
        // check on `querySelector` finds the stale node and passes. The count is what says which
        // happened, and `userRuns` is what says the commit re-ran at all rather than doing nothing.
        const painted = into.querySelector('b') as HTMLElement
        const before = userRuns
        release()
        await navigating

        expect(userRuns).toBeGreaterThan(before)
        expect(into.querySelectorAll('b')).toHaveLength(1)
        expect(into.querySelector('b')).toBe(painted)
        expect(painted.isConnected).toBe(true)
        expect(painted.textContent).toContain('user 3')
    } finally {
        view.dispose()
    }
})

test('the page view runs once for the navigation, not once per piece', async () => {
    const pieces = await fragmentFor('/users/4', 'the panel')
    answerWith(pieces)
    const into = container()
    const view = mount(into, outlet)
    try {
        userRuns = 0
        const navigating = navigate('/users/4')
        release()
        await navigating
        await until(() => into.textContent?.includes('the panel') === true, 'the patch')

        // The commit is ONE bump — `adopted` and the route's name move together and the renderer
        // takes both in a single flush. A view that ran per piece would be a page rebuilt behind
        // every panel that landed, and every patch on a busy page would cost another pass.
        expect(userRuns).toBe(1)
        expect(route().params.id).toBe('4')
        expect(route().navigating).toBe(false)
    } finally {
        view.dispose()
    }
})

test('an overtaken navigation stops painting, rather than patching into the page that replaced it', async () => {
    const first = await fragmentFor('/users/6', 'panel from six')
    const second = await fragmentFor('/users/7', 'panel from seven')

    // Two gated bodies, one per URL — `answerWith` holds back one response, and the whole point here
    // is that the FIRST one is still arriving while the second lands.
    let releaseFirst: () => void = () => undefined
    let releaseSecond: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
        releaseFirst = resolve
    })
    const heldSecond = new Promise<void>((resolve) => {
        releaseSecond = resolve
    })
    const bodyFor = (pieces: string[], gate: Promise<void> | null): ReadableStream<Uint8Array> => {
        const whole = pieces.join('')
        const cut = whole.indexOf(PIECE_END) + PIECE_END.length
        return new ReadableStream<Uint8Array>({
            async start(controller) {
                const encoder = new TextEncoder()
                controller.enqueue(encoder.encode(whole.slice(0, cut)))
                if (gate !== null) await gate
                if (cut < whole.length) controller.enqueue(encoder.encode(whole.slice(cut)))
                controller.close()
            },
        })
    }
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
        const headers = new Headers({ [NAVIGATION_HEADER]: '1' })
        const six = String(input).includes('/users/6')
        return new Response(bodyFor(six ? first : second, six ? held : heldSecond), {
            status: 200,
            headers,
        })
    }) as typeof fetch

    const into = container()
    const view = mount(into, outlet)
    try {
        // Not awaited: `navigate` resolves when the STREAM is done, and this one's panel is being
        // held back. Its first piece is on screen either way, which is what the reader has.
        const overtaken = navigate('/users/6')
        await until(() => into.textContent?.includes('user 6') === true, 'the first page')

        // Held back too, so the live page's placeholder is still STANDING when the abandoned one's
        // patch arrives. That is the whole collision: placeholder ids are per-render counters, so
        // both pages named theirs the same thing.
        const live = navigate('/users/7')
        await until(() => into.textContent?.includes('loading') === true, 'the second page')

        releaseFirst()
        await overtaken

        // Nothing of the abandoned page reached the live one's placeholder — which is still standing,
        // waiting for its own panel.
        expect(into.textContent).not.toContain('panel from six')
        expect(into.textContent).toContain('loading')
        // Nor did it commit its ROUTE on the way out. The live navigation has not committed either —
        // that waits for its range to be whole — so what this pins is that finishing an abandoned
        // stream is not what puts the reader back on `/users/6` while the address bar says `/users/7`.
        expect(route().params.id).not.toBe('6')
        expect(into.textContent).toContain('user 7')

        releaseSecond()
        await live
        expect(into.textContent).toContain('panel from seven')
        expect(route().params.id).toBe('7')
        expect(route().navigating).toBe(false)
    } finally {
        view.dispose()
    }
})

test('a patch finds its placeholder without searching the page', async () => {
    const pieces = await fragmentFor('/panels', 'landed')
    answerWith(pieces)
    const into = container()
    const view = mount(into, outlet)

    // The tag is written down rather than imported, for the reason `PIECE_END` above is: this file
    // holds itself to what an app can reach. A renamed tag makes the count 0 for the wrong reason,
    // and the `<i>` assertions beside it are what catch that.
    let pageScans = 0
    const realQuerySelector = Element.prototype.querySelector
    Element.prototype.querySelector = function scanning(this: Element, selector: string) {
        if (selector.includes('slot-s')) pageScans++
        return realQuerySelector.call(this, selector)
    } as typeof Element.prototype.querySelector

    try {
        const navigating = navigate('/panels')
        release()
        await navigating

        expect(into.querySelectorAll('i')).toHaveLength(3)
        expect(into.querySelectorAll('slot-s')).toHaveLength(0)
        // Not one page walk for three patches. A scan per patch is O(patches x page), and the page
        // is what the earlier patches have been growing — invisible in the output, which is why the
        // count is the assertion.
        expect(pageScans).toBe(0)
    } finally {
        Element.prototype.querySelector = realQuerySelector
        view.dispose()
    }
})

test('a disposed renderer stops being the one a navigation paints into', async () => {
    const pieces = await fragmentFor('/users/8', 'the panel')
    answerWith(pieces)
    const into = container()
    // Mounted and torn down — a page that swapped its outlet, or a test that cleaned up after
    // itself. The part's anchor leaves the document with it.
    mount(into, outlet).dispose()

    const navigating = navigate('/users/8')
    release()
    await navigating

    // Nothing was even asked for. Left installed, the sink answers with a part whose anchor has no
    // parent, so the fetch happens, the whole body is read and parsed, `before()` inserts against a
    // detached node — a spec no-op — and the navigation resolves having painted nothing. Every
    // assertion about the page still passes; only the request says it happened at all.
    expect(asked).toBeNull()
    expect(into.textContent).toBe('')
})

test('a response that is not a navigation is the browser’s, and commits nothing here', async () => {
    const pieces = await fragmentFor('/users/5', 'the panel')
    // The app refused, or answered with something that is not a page. The SERVER has written the
    // response for this URL, so the browser renders it rather than this side inventing a second
    // refusal beside it — and nothing is committed against a document that is going.
    answerWith(pieces, { ok: false })
    const into = container()
    const view = mount(into, outlet)
    try {
        const before = route().url.pathname
        await navigate('/users/5')
        expect(into.textContent).not.toContain('user 5')
        // Nothing moved on this side: the address the router answers about is the one it already had.
        expect(route().url.pathname).toBe(before)
    } finally {
        view.dispose()
    }
})

/**
 * The same body, delivered in fixed-size chunks that pay no attention to where the sentinels are.
 *
 * `answerWith` cuts exactly AT a piece boundary, which is the one split the reader cannot get wrong.
 * A real socket splits wherever the network did — so `<!--abide:piece-->` arrives with its head in
 * one chunk and its tail in the next, and a reader that only searches the newest chunk has to carry
 * enough of the previous one to still see it.
 */
function answerInChunks(pieces: string[], size: number): void {
    asked = null
    release = () => undefined
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        asked = {
            url: String(input),
            headers: new Headers(init?.headers),
            credentials: init?.credentials,
            redirect: init?.redirect,
        }
        const whole = pieces.join('')
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                const encoder = new TextEncoder()
                for (let at = 0; at < whole.length; at += size) {
                    controller.enqueue(encoder.encode(whole.slice(at, at + size)))
                }
                controller.close()
            },
        })
        const headers = new Headers()
        headers.set(NAVIGATION_HEADER, '1')
        return new Response(body, { status: 200, headers })
    }) as typeof fetch
}

test('a sentinel split across two chunks is still found', async () => {
    const pieces = await fragmentFor('/users/6', 'the panel')
    // 7 is coprime with nothing in particular and shorter than the 18-character sentinel, so every
    // `<!--abide:piece-->` in the body is split across at least two chunks — including the straddle
    // where the sentinel starts in one chunk and ends three chunks later.
    answerInChunks(pieces, 7)
    const into = container()
    const view = mount(into, outlet)
    try {
        await navigate('/users/6')
        // Both pieces landed: the opening one that stands in the range, and the patch behind it.
        expect(into.textContent).toContain('user 6')
        expect(into.textContent).toContain('the panel')
        expect(into.textContent).not.toContain('loading')
        // And no sentinel leaked into the document as text.
        expect(into.textContent).not.toContain('abide:piece')
    } finally {
        view.dispose()
    }
})
