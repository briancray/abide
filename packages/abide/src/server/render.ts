// 35.4 and 35.5 — `render` takes a component already bound to its props and produces the document
// as an async generator of bytes.

import { EARLY_CALLS } from '#shared/EARLY_CALLS.ts'
import { isThenable } from '#shared/reactive/isThenable.ts'
import {
    currentShare,
    leaveShare,
    resumeShare,
    type ShareScope,
} from '#shared/reactive/share.ts'
import type { RpcRequest } from '#shared/rpcRequest.ts'
import { VERSION_HEADER } from '#shared/VERSION_HEADER.ts'
import { REGION_CLOSE, REGION_OPEN } from '#ui/REGION.ts'
import { currentRequestScope } from './requestScope.ts'

// REGISTRY declares `Component` opaque. What a compiled component IS today is a function
// returning its markup, and the cast lives here, in one place, rather than in the type an app
// reads. It becomes a richer thing when a component takes props (33) and holds state (34.1).
// The emptiness IS the surface — a component is opaque to an app — so narrowing it here to
// satisfy the linter would put the code and the registry row out of step, which is the drift
// the documents exist to stop.
// biome-ignore lint/suspicious/noEmptyInterface: REGISTRY declares `interface Component {}`.
export interface Component {}

// 35.6 — the document a render renders into, defaulting to `src/ui/app.html`.
export type Shell = string | URL | undefined

// Where a shell was not given and `src/ui/app.html` is not there either. The rulebook does not
// say what happens in that case; serving nothing would be worse than serving this.
const BARE_SHELL = '<!doctype html><html><head></head><body></body></html>'

const ENCODER = new TextEncoder()

// What a compiled component answers. One reference beyond the cast that reads it — the `await`
// guard needs the settled shape and the promise shape to be the same name.
export type Rendered = { head: string; body: string }

// 35.1 — THE PAGE, INSIDE ITS LAYOUTS, outermost first. A layout renders its child through a
// slot (32.19), so the composition is the same `children` thunk a caller writing markup between
// two tags hands over — there is no layout API and no second kind of component, which is what
// the documentation says a layout is and what this is.
//
// THE HEADS COME UP WITH THE BODY. A layout's own contributions are in the record it answers;
// what the page under it contributed is pushed as the thunk runs, so the document carries both
// and the order is the tree's (39.5).
// THE SHAPE IS THE SAME AT EVERY LEVEL, `children` included. The emitted readers are shared with
// the client, where `Router.ts`'s `routeProps` mints the record with both keys for the same
// reason: every compiled page and layout loads its props off one of these, and a level that omits a
// key the level above it carries is a second hidden class for all of them. The innermost has
// nothing below it, so its `children` is present and undefined rather than absent.
//
// 41.20 — EVERY LEVEL IS SET UP BEFORE ANY IS BUILT, and the turn is let run between the two, so a
// call the setup started that answers without waiting on anything — a value already held, a
// handler that only awaits what it has — is painted rather than left for the browser to fill. A
// compiled page or layout answers `head` and `body` lazily and says which share scope its setup ran
// in (`scope`), so the level below is set up inside it as it would have been inside the build
// (10.5), and a level's `children` reads a level that is already set up.
export async function composePage(
    layouts: Component[],
    page: Component,
    props: Record<string, (() => unknown) | undefined>,
): Promise<Rendered> {
    const heads: string[] = []
    const levels: (Rendered & { scope: ShareScope | null })[] = []
    for (let at = 0; at <= layouts.length; at += 1) {
        const inner = at === layouts.length
        const component = (inner ? page : layouts[at]) as (
            props: Record<string, (() => unknown) | undefined>,
        ) => Rendered & { scope: ShareScope | null }
        const children = inner
            ? undefined
            : (): string => {
                  const below = levels[at + 1] as Rendered
                  if (below.head !== '') heads.push(below.head)
                  return below.body
              }
        const above = levels[at - 1]
        const back =
            above === undefined ? currentShare() : resumeShare(above.scope)
        try {
            levels.push(component({ ...props, children }))
        } finally {
            leaveShare(back)
        }
    }
    await new Promise((settled) => setImmediate(settled))
    const outermost = levels[0] as Rendered
    // BUILT ON THE FIRST READ, not here: `render` writes the early-call script between the setup
    // this has just finished and the markup (41.21), so the calls leave before the page is built.
    // THE OUTERMOST HEAD FIRST: reading it builds the chain, which is what pushes the heads below.
    let built: Rendered | undefined
    const build = (): Rendered => {
        if (built === undefined) {
            const head = outermost.head
            built = { head: head + heads.join(''), body: outermost.body }
        }
        return built
    }
    return {
        get head() {
            return build().head
        },
        get body() {
            return build().body
        },
    }
}

export async function* render(
    component: Component,
    shell?: Shell,
): AsyncGenerator<Uint8Array> {
    // GUARDED, because the string form is already settled: `shellText` is `async`, so awaiting it
    // unconditionally wrapped a promise and spent a microtask turn per request for nothing.
    const document = typeof shell === 'string' ? shell : await shellText(shell)

    // TWO INSERTION POINTS, CLAMPED AND ORDERED. `</head>` and `</body>` are both OPTIONAL end
    // tags, so a valid shell can carry neither: an absent anchor means "the end of the document",
    // and the clamp is what keeps the head ahead of the body whatever order the shell wrote them in.
    const bodyAt = bodyAnchor(document)
    const headAt = headAnchor(document)
    // 41.1 — THE SHELL'S HEAD BEFORE THE COMPONENT IS ASKED. It is known the moment the shell is,
    // and it is what starts every fetch the document makes — the stylesheet, the entry and its
    // preloads (38.23, 38.24, 38.29) — so nothing the page does holds it. What the PAGE puts in the
    // head goes out with the body: it is the page's answer, and it cannot be known sooner.
    //
    // 41.16 — A THROW AFTER THIS POINT ENDS THE STREAM IN AN ERROR, not in a document. The status
    // line is on the wire, so it cannot become a 500; a response that stops short of its
    // terminating chunk is one every client and cache reads as incomplete, where an error page
    // written into the body would be a complete 200 somebody stores.
    yield ENCODER.encode(document.slice(0, headAt))
    // 34.3 — SETUP IS SYNCHRONOUS, so a bare component answers its record outright, and the guard
    // spends no microtask turn on it. 41.1 — BUT IT MAY BE PENDING: the head has already gone out,
    // so a caller with something to wait on first — `answerRequest` importing the page and its
    // chain — hands over a component whose record is a promise, and the wait lands after the flush.
    const answered = (component as () => Rendered | PromiseLike<Rendered>)()
    const rendered = isThenable(answered) ? await answered : answered
    // 41.21 — THE PAGE'S CALLS LEAVE BEFORE ITS MARKUP IS BUILT. Setup has run, so every call the
    // page makes is known, and a script in the head starts each one as the request the browser's
    // own `Rpc` would make — while the rest of the document and the bundle are still on their way.
    // Each is its own request, so the network panel shows them as it would have anyway.
    const calls = currentRequestScope()?.page?.calls
    if (calls !== undefined && calls.length > 0)
        yield ENCODER.encode(earlyCallScript(calls))
    // 41.9 — THE PAGE IS A REGION LIKE ANY OTHER, and written between the same pair
    // `renderComponent` writes a child between. A router swaps what stands between them, and with
    // the pair on the wire the client finds the page rather than guessing where it ends among
    // whatever else the shell put in the body.
    yield ENCODER.encode(
        `${rendered.head}${document.slice(headAt, bodyAt)}<!--${REGION_OPEN}-->${rendered.body}<!--${REGION_CLOSE}-->${document.slice(bodyAt)}`,
    )
}

// 41.21 — THE SCRIPT ITSELF: each call started with `fetch`, and its answer left under the call's key
// in `EARLY_CALLS` for `wire` to take (41.22). A framed answer's body is left UNREAD (16.33), so a
// streaming handler's copy takes its chunks as they land rather than after the last one. Inline because nothing else runs before the bundle
// has arrived, which is the wait it exists to overlap.
//
// 29.9, 29.10 — THE CALLS ARE DATA AND THE RUNNER IS A CONSTANT. What a page called differs per
// response, so it rides in a JSON block a browser never executes, and the one script that does run
// is the same bytes in every response — which is what lets `csp` permit it by its hash rather than
// by the nonce an app's own inline script spends. The JSON has `<` escaped, so no string in it can
// close the element.
function earlyCallScript(calls: RpcRequest[]): string {
    const rows: [string, string, RequestInit][] = []
    for (const call of calls) rows.push([call.key, call.url, call.init])
    return `<script type="application/json">${JSON.stringify(rows).replace(/</g, '\\u003c')}</script><script>${EARLY_CALL_RUNNER}</script>`
}

const EARLY_CALL_RUNNER = `(function(s,c){for(var i=0;i<c.length;i++)(function(k,u,n){var e=s[k]={status:void 0,statusText:void 0,type:void 0,version:void 0,life:void 0,text:void 0,body:void 0};e.promise=fetch(u,n).then(function(r){e.status=r.status;e.statusText=r.statusText;e.type=r.headers.get("content-type");e.version=r.headers.get("${VERSION_HEADER}");e.life=r.headers.get("cache-control");if(r.ok&&/^(application\\/jsonl|text\\/event-stream)/.test(e.type||"")){e.body=r.body;return}return r.text()}).then(function(t){if(t!==void 0)e.text=t},function(){})})(c[i][0],c[i][1],c[i][2])})(self.${EARLY_CALLS}||(self.${EARLY_CALLS}={}),JSON.parse(document.currentScript.previousElementSibling.textContent))`

// 29.9 — the runner's hash, as `script-src` names it.
export const EARLY_CALL_HASH = `'sha256-${new Bun.CryptoHasher('sha256').update(EARLY_CALL_RUNNER).digest('base64')}'`

// Where the body's content ends, which is where a page's markup goes.
function bodyAnchor(document: string): number {
    const found = document.lastIndexOf('</body>')
    return found === -1 ? document.length : found
}

// Where a shell's head ends, clamped ahead of its body.
//
// NOT PUBLIC SURFACE: `server/index.ts` does not re-export it. `answerRequest` is the second caller —
// a shell has to carry the client entry's script tag (38.23), and putting that anywhere but the
// head this finds is the same clamped-and-ordered question over again.
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

// Where `<body` opens, or -1. Matched on the tag name rather than on `<body>` so an attribute on
// it — `<body class="…">`, which a shell usually has — is still found. Case-insensitive without
// lowercasing a copy of the whole shell.
function bodyOpen(document: string): number {
    return document.search(/<body(?=[\s>]|$)/i)
}

// The URL and absent forms only — the string form is already settled and its caller above takes
// it without a turn, so a second copy of that test here is a branch nothing reaches and a second
// owner of the question.
async function shellText(shell: URL | undefined): Promise<string> {
    if (shell !== undefined) return await Bun.file(shell).text()
    return await shellUnder('src')
}

// 35.6's default, read from a ROOT rather than from the process's directory. `render` on its own
// is called from wherever the app is, so `src` is the root it passes; `serveBuild` is handed the
// root `abide build` compiled and the two need not be the same directory. NOT PUBLIC SURFACE —
// `server/index.ts` does not re-export it.
export async function shellUnder(root: string): Promise<string> {
    // `.text()` already fails when the file is not there, so no `.exists()` asks first. The read
    // happens per render for a bare `render` call — 20 µs and 98% of the op — and `serveBuild` is the caller that hoists
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
