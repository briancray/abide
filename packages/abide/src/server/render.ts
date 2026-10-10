// 35.4 and 35.5 — `render` takes a component already bound to its props and produces the document's
// bytes.

/// <reference path="./componentModules.d.ts" />

import { regionMarkup } from '#shared/anchorMarkup.ts'
import { EARLY_CALLS } from '#shared/EARLY_CALLS.ts'
import { headKeyOf } from '#shared/headKeyOf.ts'
import { isReactive, isStreaming, loadOf } from '#shared/reactive/index.ts'
import { isThenable } from '#shared/reactive/isThenable.ts'
import type { ShareScope } from '#shared/reactive/share.ts'
import { setUpLevels } from '#shared/setUpLevels.ts'
import { VERSION_HEADER } from '#shared/VERSION_HEADER.ts'
import { currentRequestScope, type PageCall } from './requestScope.ts'

/**
 * A compiled component, opaque to an app.
 *
 * REGISTRY declares `Component` opaque. What a compiled component IS on the server is a function
 * taking its props as accessors (33.4) and answering a `Rendered` — and, for a page or a layout,
 * the share scope its setup ran in. The cast to that lives at each call site here and in
 * `renderComponent`, rather than in the type an app reads.
 * The emptiness IS the surface — a component is opaque to an app — so narrowing it here to
 * satisfy the linter would put the code and the registry row out of step, which is the drift
 * the documents exist to stop.
 */
// biome-ignore lint/suspicious/noEmptyInterface: REGISTRY declares `interface Component {}`.
export interface Component {}

/** The document a render renders into, defaulting to `src/ui/app.html`. 35.6. */
export type Shell = string | URL | undefined

// Where a shell was not given and `src/ui/app.html` is not there either. The rulebook does not
// say what happens in that case; serving nothing would be worse than serving this.
const BARE_SHELL = '<!doctype html><html><head></head><body></body></html>'

const ENCODER = new TextEncoder()

/** What a compiled component answers: its head and its body markup. */
export type Rendered = { head: string; body: string }

/**
 * The page inside its layouts, every level set up first and then built.
 *
 * 35.1 — THE PAGE, INSIDE ITS LAYOUTS, outermost first. A layout renders its child through a
 * slot (32.18), so the composition is the same `children` thunk a caller writing markup between
 * two tags hands over — there is no layout API and no second kind of component, which is what
 * the documentation says a layout is and what this is. The chain's order, share scopes and props
 * shape are `setUpLevels`', which the client `Router` composes through too.
 *
 * THE HEADS COME UP WITH THE BODY. A layout's own contributions are in the record it answers;
 * what the page under it contributed is pushed as the thunk runs, so the document carries both
 * and the order is the tree's (39.5).
 *
 * 41.19 — THE TURN IS LET RUN BETWEEN SETUP AND BUILD, so a call the setup started that answers
 * without waiting on anything — a value already held, a handler that only awaits what it has — is
 * painted rather than left for the browser to fill. A compiled page or layout answers `head` and
 * `body` lazily and says which share scope its setup ran in (`scope`), and a level's `children`
 * reads a level that is already set up.
 */
export async function composePage(
    layouts: Component[],
    page: Component,
    props: Record<string, () => unknown>,
): Promise<Rendered> {
    const heads: string[] = []
    const levels: (Rendered & { scope: ShareScope | null })[] = []
    setUpLevels(0, layouts.length + 1, undefined, props, (at, levelProps) => {
        if (at < layouts.length)
            levelProps.children = (): string => {
                const below = levels[at + 1] as Rendered
                if (below.head !== '') heads.push(below.head)
                return below.body
            }
        const level = (
            (layouts[at] ?? page) as (
                props: Record<string, (() => unknown) | undefined>,
            ) => Rendered & { scope: ShareScope | null }
        )(levelProps)
        levels.push(level)
        return level.scope
    })
    await new Promise((settled) => setImmediate(settled))
    const outermost = levels[0] as Rendered
    // THE OUTERMOST HEAD FIRST: reading it builds the chain, which is what pushes the heads below.
    // Written end to end rather than merged: `render` merges it with the shell's in one pass (39.4).
    const head = outermost.head
    return { head: head + heads.join(''), body: outermost.body }
}

/**
 * The document's opening up to its head's end, with the page's head and early-call script after
 * the shell's, and every keyed head element but the LAST for its key dropped.
 *
 * 39.4, 39.11 — THE DEEPEST CONTRIBUTOR WINS, and the markup is in tree order — the shell's head
 * (its outermost contributor), then each level's, outermost first — so the deepest is the last.
 * Written end to end instead, a shell's or a layout's `<title>` stands ahead of its page's and a
 * browser reads the first. The compiler merges within a file (39.12) and `applyHead` across a
 * navigation; this is the same grammar across the contributors of one render.
 *
 * TOP LEVEL OF THE HEAD ONLY, as `applyHead` keys the head's children and nothing inside them.
 * The attribute is the one WRITTEN rather than decoded — a shell's escaping and the compiler's
 * agree on every key a shell and a page would plausibly share.
 *
 * THE COMMON SHAPE READS THE LEVELS' MARKUP ALONE: a page keys a `<title>` the shell does not, so
 * nothing of the shell's is dropped and its own merge, taken once per shell, is the whole of it.
 * The early-call script is `<script>`s, which key nothing. Rewriting the whole opening instead
 * was ~4 µs of a ~6 µs render, in-process under JSC.
 */
function mergeHead(
    document: string,
    headAt: number,
    early: string,
    head: string,
): string {
    const shell = shellHeadOf(document, headAt)
    if (!MAY_HOLD_A_KEY.test(head)) return shell.merged + early + head
    const own = keyCounts(head)
    let clashes = false
    for (const [key, count] of own) {
        const shells = shell.keys.get(key)
        if (count > 1 || shells !== undefined) {
            clashes = true
            own.set(key, count + (shells ?? 0))
        }
    }
    if (!clashes) return shell.merged + early + head
    // Every key's count over the whole opening is the shell's and the levels', summed.
    for (const [key, count] of shell.keys)
        if (!own.has(key)) own.set(key, count)
    return dropShadowed(`${document.slice(0, headAt)}${early}${head}`, own)
}

// A tag `headKeyOf` can key, in any case: markup matching nothing here keys nothing.
const MAY_HOLD_A_KEY = /<(?:title|base|meta|link)[\s/>]/i

// ONE SHELL AT A TIME: an app renders into one, so the slot is only refilled by a test or a
// shell read from a `URL` per render — and then compared by content, which is still cheaper than
// the rewrite it saves.
type ShellHead = {
    document: string
    keys: Map<string, number>
    merged: string
}
let lastShell: ShellHead | undefined

function shellHeadOf(document: string, headAt: number): ShellHead {
    if (lastShell?.document !== document) {
        const opening = document.slice(0, headAt)
        lastShell = {
            document,
            keys: keyCounts(opening),
            merged: mergeKeyed(opening),
        }
    }
    return lastShell
}

/** How many times each key stands at the top of `markup`'s head. */
function keyCounts(markup: string): Map<string, number> {
    const counts = new Map<string, number>()
    dropAtHeadTop(new HTMLRewriter(), markup, (key) => {
        if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1)
        return false
    })
    return counts
}

/** `markup` with every keyed element at the top of its head but the last for its key dropped. */
function mergeKeyed(markup: string): string {
    const total = keyCounts(markup)
    for (const count of total.values())
        if (count > 1) return dropShadowed(markup, total)
    return markup
}

/** `markup` with each key's elements at the top of its head dropped but the last of `total`. */
function dropShadowed(markup: string, total: Map<string, number>): string {
    const passed = new Map<string, number>()
    return dropAtHeadTop(new HTMLRewriter(), markup, (key) => {
        if (key === undefined) return false
        const at = (passed.get(key) ?? 0) + 1
        passed.set(key, at)
        return at < (total.get(key) as number)
    })
}

/**
 * The keyed elements at the top of a shell's head, end to end, and nothing else.
 *
 * 39.14 — WHAT A CLIENT NAVIGATION PUTS BACK. `mergeHead` drops every shell entry a level
 * overrides, so once the server has painted the document the shell's `<title>` is nowhere a
 * browser can read it — and a navigation to a page with no title owes it back. The build hands
 * these to the router rather than the server writing them into each page: the shell is one per
 * app, so it rides in the route table once instead of in every document. KEYED ONLY, because an
 * entry with no key is never withdrawn (39.5) and a shell's inline `<style>` would be the route
 * table's largest string for nothing. Top level only, as `mergeHead` keys it.
 */
export function keyedHead(document: string): string {
    const unwrap = {
        element(element: HTMLRewriterTypes.Element) {
            element.removeAndKeepContent()
        },
    }
    const top = { depth: 0 }
    const rewriter = new HTMLRewriter()
        .onDocument({
            doctype(doctype) {
                doctype.remove()
            },
            comments(comment) {
                comment.remove()
            },
            text(text) {
                if (top.depth === 0) text.remove()
            },
        })
        .on('html', unwrap)
        .on('head', unwrap)
    return dropAtHeadTop(
        rewriter,
        document.slice(0, headAnchor(document)),
        (key) => key === undefined,
        top,
    )
}

/**
 * `markup` through `rewriter`, with each element at the top of the head removed where `drop`
 * answers true for its key — `undefined` for an element with none. `top` is the depth the walk is
 * at, for a caller's own handlers to read.
 *
 * `<html>` and `<head>` are the shell's frame and open no depth. A keyed element never holds an
 * element (a `<title>` holds text), so a dropped one takes no depth with it.
 */
function dropAtHeadTop(
    rewriter: HTMLRewriter,
    markup: string,
    drop: (key: string | undefined) => boolean,
    top = { depth: 0 },
): string {
    return rewriter
        .on('*', {
            element(element) {
                const tag = element.tagName
                if (tag === 'html' || tag === 'head') return
                if (
                    top.depth === 0 &&
                    drop(headKeyOf(tag, (name) => element.getAttribute(name)))
                ) {
                    element.remove()
                    return
                }
                if (element.canHaveContent && !element.selfClosing) {
                    top.depth += 1
                    element.onEndTag(() => {
                        top.depth -= 1
                    })
                }
            },
        })
        .transform(markup)
}

/**
 * A page or error page bound to its props: imports it and its layouts, then composes them.
 *
 * THE IMPORTS ARE THE COMPONENT'S, so a page nobody asks for is never loaded, and the first
 * request for one after boot pays its import before the document goes out (41.1).
 *
 * THE PAGE AND ITS CHAIN, IN ONE ROUND OF WAITING. A nested `Promise.all` rather than one
 * flat array with the page spliced onto the head: the two settle together either way, and the
 * flat form's element type is the union of the two, so reading a head and a tail back off it
 * took an `as` per read. This is the same concurrency with the types carrying it.
 *
 * STARTED WHEN `render` ASKS, not here. The page is bound before the `HEAD` answer returns, and
 * started here that answer would import the page for a body nobody is sent — and a failed import
 * would reject with nothing awaiting it, where `render`'s is awaited inside the `try` that turns
 * it into a status.
 *
 * 35.3 — BOUND HERE, because `render` takes a component that already has its props. An error page
 * is bound the same way, with the failure where a page has its params.
 */
export function boundPage(
    page: {
        load: () => Promise<{ default: Component }>
        layouts: (() => Promise<{ default: Component }>)[]
    },
    props: Record<string, () => unknown>,
): () => Promise<unknown> {
    return async () => {
        const [loadedPage, loadedLayouts] = await Promise.all([
            page.load(),
            Promise.all(page.layouts.map((layout) => layout())),
        ])
        const layouts: Component[] = []
        for (const module of loadedLayouts) layouts.push(module.default)
        return composePage(layouts, loadedPage.default, props)
    }
}

/**
 * The document's bytes: `component` rendered into `shell`.
 *
 * 35.4, 35.5 — the component is already bound to its props.
 */
export async function render(
    component: Component,
    shell?: Shell,
): Promise<Uint8Array<ArrayBuffer>> {
    // GUARDED, because the string form is already settled: `shellText` is `async`, so awaiting it
    // unconditionally wrapped a promise and spent a microtask turn per request for nothing.
    const document = typeof shell === 'string' ? shell : await shellText(shell)

    // TWO INSERTION POINTS, CLAMPED AND ORDERED. `</head>` and `</body>` are both OPTIONAL end
    // tags, so a valid shell can carry neither: an absent anchor means "the end of the document",
    // and the clamp is what keeps the head ahead of the body whatever order the shell wrote them in.
    const bodyAt = bodyAnchor(document)
    const headAt = headAnchor(document)
    // 41.1 — NOTHING GOES OUT UNTIL THE PAGE IS BUILT. The status line goes out with the first byte,
    // and a page reading a record that is not there is a 404 only while no byte has: so the page and
    // its layouts are set up (41.19) and built before the shell's head is sent, and a refusal or a
    // throw on the way is the caller's to answer at its own status (35.2) rather than a 200 cut short.
    // What waits is the import on a page's first request and its setup and build after that; a
    // value still in flight is a sink as before (41.4), and costs the wait nothing.
    //
    // 34.3 — SETUP IS SYNCHRONOUS, so a bare component answers its record outright, and the guard
    // spends no microtask turn on it. A caller with something to wait on first — `answerRequest`
    // importing the page and its chain — hands over a component whose record is a promise.
    const answered = (component as () => Rendered | PromiseLike<Rendered>)()
    const rendered = isThenable(answered) ? await answered : answered
    const head = rendered.head
    const body = rendered.body
    // 41.20 — THE PAGE'S CALLS LEAVE AHEAD OF ITS MARKUP. Setup has run, so every call the page
    // makes is known, and a script in the head starts each one as the request the browser's own
    // `Rpc` would make — while the rest of the document and the bundle are still on their way.
    const calls = currentRequestScope()?.page?.calls
    const early =
        calls !== undefined && calls.length > 0 ? earlyCallScript(calls) : ''
    // 39.4 — THE SHELL IS THE OUTERMOST CONTRIBUTOR, so its head is merged with the page's in the
    // one pass that merges the levels'.
    //
    // 41.9 — THE PAGE IS A REGION LIKE ANY OTHER, and written between the same pair
    // `renderComponent` writes a child between. A router swaps what stands between them, and with
    // the pair on the wire the client finds the page rather than guessing where it ends among
    // whatever else the shell put in the body.
    return ENCODER.encode(
        `${mergeHead(document, headAt, early, head)}${document.slice(headAt, bodyAt)}${regionMarkup(body)}${document.slice(bodyAt)}`,
    )
}

/**
 * The head markup that starts each of the page's calls before the bundle arrives.
 *
 * 41.20 — THE SCRIPT ITSELF: each call started with `fetch`, and its answer left under the call's
 * key in `EARLY_CALLS` for `wire` to take (41.21). A framed answer's body is left UNREAD (16.32),
 * so a streaming handler's copy takes its chunks as they land rather than after the last one.
 * Inline because nothing else runs before the bundle has arrived, which is the wait it exists to
 * overlap.
 *
 * 41.25 — A ROW ENDING IN `1` IS A CALL THE MARKUP WAS BUILT FROM SETTLED, a refusal included, and
 * its entry is marked `painted` for hydration to wait on — a body that is not JSON read to its bytes,
 * so the wait covers it too. Read here, where the markup has just been built and only microtasks
 * have run since. 41.26 — A CALL THAT STREAMS IS NEVER MARKED: the
 * browser reads its chunks as they land (16.32), so no wait for its answer makes it settled where
 * the page hydrates, and its region is 41.24's to put right.
 *
 * 29.9, 29.10 — THE CALLS ARE DATA AND THE RUNNER IS A CONSTANT. What a page called differs per
 * response, so it rides in a JSON block a browser never executes, and the one script that does run
 * is the same bytes in every response — which is what lets `csp` permit it by its hash rather than
 * by the nonce an app's own inline script spends. The JSON has `<` escaped, so no string in it can
 * close the element.
 */
function earlyCallScript(calls: PageCall[]): string {
    const rows: (
        | [string, string, RequestInit]
        | [string, string, RequestInit, 1]
    )[] = []
    for (const { request, reached } of calls)
        rows.push(
            isReactive(reached) &&
                loadOf(reached) === undefined &&
                !isStreaming(reached)
                ? [request.key, request.url, request.init, 1]
                : [request.key, request.url, request.init],
        )
    return `<script type="application/json">${JSON.stringify(rows).replace(/</g, '\\u003c')}</script><script>${EARLY_CALL_RUNNER}</script>`
}

const EARLY_CALL_RUNNER = `(function(s,c){for(var i=0;i<c.length;i++)(function(k,u,n,h){var e=s[k]={painted:h,status:void 0,statusText:void 0,type:void 0,version:void 0,life:void 0,text:void 0,bytes:void 0,body:void 0};e.promise=fetch(u,n).then(function(r){e.status=r.status;e.statusText=r.statusText;e.type=r.headers.get("content-type");e.version=r.headers.get("${VERSION_HEADER}");e.life=r.headers.get("cache-control");if(r.ok&&e.type&&!/^application\\/([^;]*\\+)?json\\s*(;|$)/.test(e.type)){if(h)return r.arrayBuffer().then(function(b){e.bytes=new Uint8Array(b)});e.body=r.body;return}return r.text()}).then(function(t){if(t!==void 0)e.text=t},function(){})})(c[i][0],c[i][1],c[i][2],c[i][3])})(self.${EARLY_CALLS}||(self.${EARLY_CALLS}={}),JSON.parse(document.currentScript.previousElementSibling.textContent))`

/** The early-call runner's hash, as `script-src` names it. 29.9. */
export const EARLY_CALL_HASH = `'sha256-${new Bun.CryptoHasher('sha256').update(EARLY_CALL_RUNNER).digest('base64')}'`

/** Where the body's content ends, which is where a page's markup goes. */
function bodyAnchor(document: string): number {
    const found = document.lastIndexOf('</body>')
    return found === -1 ? document.length : found
}

/**
 * Where a shell's head ends, clamped ahead of its body.
 *
 * NOT PUBLIC SURFACE: `server/index.ts` does not re-export it. `answerRequest` is the second
 * caller — a shell has to carry the client entry's script tag (38.23), and putting that anywhere
 * but the head this finds is the same clamped-and-ordered question over again.
 */
export function headAnchor(document: string): number {
    const bodyAt = bodyAnchor(document)
    // THE OPENING `<body` IS THE FALLBACK, not the body anchor. Collapsed onto `bodyAt`, a shell
    // with no `</head>` put the page's `<title>`, `<meta>` and stylesheet links after the mount
    // point and inside `<body>` — still rendered, in the one place a document says they are not
    // head content.
    const headClose = document.lastIndexOf('</head>')
    const found = headClose === -1 ? bodyOpen(document) : headClose
    return found === -1 || found > bodyAt ? bodyAt : found
}

/**
 * Where `<body` opens, or -1.
 *
 * Matched on the tag name rather than on `<body>` so an attribute on it — `<body class="…">`,
 * which a shell usually has — is still found. Case-insensitive without lowercasing a copy of the
 * whole shell.
 */
function bodyOpen(document: string): number {
    return document.search(/<body(?=[\s>]|$)/i)
}

/**
 * The text of a shell given as a URL, or of the default one.
 *
 * The URL and absent forms only — the string form is already settled and its caller above takes
 * it without a turn, so a second copy of that test here is a branch nothing reaches and a second
 * owner of the question.
 */
async function shellText(shell: URL | undefined): Promise<string> {
    if (shell !== undefined) return await Bun.file(shell).text()
    return await shellUnder('src')
}

/**
 * The shell at `<root>/ui/app.html`, or a bare document where there is none.
 *
 * 35.6's default, read from a ROOT rather than from the process's directory. `render` on its own
 * is called from wherever the app is, so `src` is the root it passes; `loadBuild` is handed the
 * root `abide build` compiled and the two need not be the same directory. NOT PUBLIC SURFACE —
 * `server/index.ts` does not re-export it.
 */
export async function shellUnder(root: string): Promise<string> {
    // `.text()` already fails when the file is not there, so no `.exists()` asks first. The read
    // happens per render for a bare `render` call — 20 µs and 98% of the op — and `loadBuild` is the caller that hoists
    // it, reading the shell once at boot rather than once a request.
    try {
        return await Bun.file(`${root}/ui/app.html`).text()
    } catch (thrown) {
        // NARROWED TO THE ONE CASE THE LINE ABOVE ARGUES FOR. A bare catch made every failure look
        // like an absent file, so a project that HAS a shell which is momentarily unreadable —
        // EACCES, EISDIR, EMFILE under load — was served the bare shell with no stylesheet, no
        // client script and nothing said, on one request in a thousand.
        if ((thrown as { code?: unknown }).code !== 'ENOENT') throw thrown
        return BARE_SHELL
    }
}
