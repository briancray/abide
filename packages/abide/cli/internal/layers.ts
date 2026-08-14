// The four layers an abide app is served in, assembled once — the half `abide start` and `abide dev`
// have in common.
//
// An app is four conventions and no wiring: `app.ts` says what this app IS, `app.html` is the
// document it is served in, `pages/` is what it serves, and `server/rpc/**` and `server/sockets/**`
// are what it answers. The browser's lane is not a fifth — it is GENERATED from `pages/`, because a
// route table is already on disk and only the browser cannot read it. Nothing in any of them imports
// a server, calls `Bun.serve`, mounts `dispatch`, installs a signal handler, matches a route, builds
// a document or imports a handler for its side effect — every one of those is the same code in every
// app, and the one an app forgets is the one that matters.
//
// So `app.ts` exports HOOKS, and a route only if it wants one — and an app with none of either writes
// no `app.ts` at all. Every export it could hold is optional, so a file holding none of them says
// nothing, and a convention that can be empty is one an app should not have to write. What makes a
// directory an app is having something to SERVE: pages, endpoints, or a module that says otherwise.
//
// Nothing here is a decision an app has to restate: a pages directory is a route table, a transport
// directory is the endpoints, the request's own URL is what matched it, and the shell is the file the
// app already wrote. What is left for an app to say is the part that is actually its own.
//
// Four layers, and the ORDER is the whole design:
//
//   the client bundle   files, in front of everything, because it is not an endpoint and a page
//                       waiting on an auth rung for its own JavaScript is a page that cannot log in.
//                       Outside the request scope too: a static file has no caller to be about
//   /__abide/**         `dispatch`, which `handle` already puts in front of the app's routes
//   the app's route     the default export, if it has one, wrapped in its own middleware onion
//   the pages           whatever the app did not answer, rendered into its shell. `undefined` here
//                       is a 404, and an app with no pages is one made of endpoints
//
// What is NOT decided here is what the two commands actually differ about: where the bundle came
// from, and how the socket is bound. `abide start` reads a build off a disk and binds HARD; `abide
// dev` builds into memory, injects its reload client into the shell and HOPS. Everything above that
// seam is one assembly, so a layer that changes shape cannot change shape in only one of them.

// `node:path` stands in for nothing: Bun ships no path api, and the builtin IS the supported one.
import { basename } from 'node:path'
// `Bun.gzipSync` is what these stand in for and cannot serve: it compresses a whole BUFFER, and a
// streamed document is the one thing that does not have one. There is no flushing compressor on
// `Bun.*` — see `compressed`, which needs a block ended at every write. `Duplex.toWeb` is the bridge
// back from that node stream to the web `ReadableStream` a `Response` is built from.
import { Duplex } from 'node:stream'
import { constants, createGzip } from 'node:zlib'
// The `.abide` loader, registered by importing the module that owns the registration — the same one
// `abide run` preloads and `abide repl` makes. An app importing a page compiles it on the way in.
import '$compiler/preload.ts'
// The transport directories by their one definition, for the refusal that names them. The globs come
// from the compiler rather than being written again here, exactly as the boot's own scan takes them.
import { TRANSPORT_ROOTS } from '$compiler/internal/elide.ts'
import { type Config, type ConfigDefaults, isPort, onConfig } from '$server/config.ts'
import { type HealthReporter, onHealth } from '$server/health.ts'
import { type IdentityResolver, onIdentity } from '$server/identity.ts'
import { documentToStream, fragmentToStream } from '$server/index.ts'
import {
    type ErrorHook,
    handle,
    type Middleware,
    middleware,
    onError,
    onStart,
    onStop,
    type Route,
    type StartHook,
    type StopHook,
} from '$server/lifecycle.ts'
import { pages } from '$server/pages.ts'
import { registered } from '$server/registry.ts'
import { page } from '$server/responses.ts'
import type { Schema } from '$server/schema.ts'
import type { Shell } from '$server/shell.ts'
import { outlet, readying, type RouteEntry, route as routeAsked, routes } from '$shared/router.ts'
import { mounted } from '$shared/internal/mount.ts'
import { NAVIGATION_HEADER } from '$shared/internal/PATHS.ts'
import { isThenable, messageOf } from '$shared/internal/probes.ts'
import { acceptedEncoding, JSON_TYPE } from '$shared/internal/wire.ts'
import { appName } from '$shared/log.ts'
import { CLI_EXIT_CODES } from '../CLI_EXIT_CODES.ts'
import { refuse } from '../COMMANDS.ts'
import { CLIENT_ROUTE, type ClientGraph, type ClientManifest, firstPresent, PAGES } from '../CLIENT_BUILD.ts'
import type { ClientAssets, LoadedClient } from './assets.ts'
import { handlers } from './handlers.ts'
import { BOLD, colored, DIM, paint, plural } from './paint.ts'
import { APP_HTML, type AppShell, appShell } from './shell.ts'

/**
 * What an app SAYS about itself, in the order it is looked for — `app.ts` beside the `app.html` it is
 * served in and the `client.ts` the browser gets. One name for the app, spelled once per lane.
 *
 * ABSENT is an ordinary app. Every export this file reads is optional, so the file is too: an app of
 * pages and endpoints that wants no hook and no route of its own has nothing to put in it, and a
 * module written to hold nothing is a convention that exists to be satisfied.
 *
 * No `.abide` here, where the client list has one: a `.abide` file compiles to a COMPONENT, and this
 * module is asked for hooks. A `.abide` app entry would be a page with nowhere to be served from.
 */
const CONVENTIONAL = ['app.ts', 'app.tsx', 'app.js']

/** Hoisted: the render reads it once and keeps nothing, so a literal here would be per request. */
const HYDRATABLE = { hydratable: true }

/** What answers a request: the bundle in front, then `handle`'s pipeline. What `Bun.serve` is given. */
export type Answer = ReturnType<typeof handle>

/** What a command tells this about the app it is assembling. */
export interface Assembling {
    root: string
    /**
     * What a refusal is prefixed with — `abide start`, `abide dev`.
     *
     * The messages are written ONCE here rather than per command, because they are all about the
     * same four conventions: a directory with nothing to serve is the same mistake whichever command
     * found it, and the two drifting apart is a fix applied to whichever one somebody hit first.
     */
    label: string
    /**
     * The bundle, however it was produced. `null` is an app with no client lane.
     *
     * A PROMISE is welcome and `abide dev` hands one: building the client and importing the app read
     * nothing of each other, and nothing here reads the bundle until the shell is cut — so the build
     * overlaps the import rather than following it, on every save. Guarded rather than awaited, so
     * `abide start`'s already-settled value costs no tick.
     */
    client: LoadedClient | null | Promise<LoadedClient | null>
    /** Appended to the end of the shell's head. The tag naming `abide dev`'s reload client, and nothing more. */
    head?: string
}

/** The assembled app: what serves it, and the three facts the report is built from. */
export interface Assembly {
    /** `null` for an app that wrote no module of its own — pages and endpoints are the whole of it. */
    entry: string | null
    paged: Paged | null
    /** The bundle this was assembled WITH, so a report cannot describe a different one. */
    assets: ClientAssets | null
    answer: Answer
}

/**
 * The app at `root`, ready to be handed a socket — or the exit code of a refusal already PRINTED.
 *
 * A number back rather than a throw, because every failure here is one an operator has to read and
 * act on rather than one a stack trace helps with: a missing `app.ts`, an export of the wrong shape,
 * an `app.html` with nowhere to render. `usage` for a command pointed at the wrong directory and
 * `failed` for an app that is there and broken — the same split every other command makes.
 */
export async function assemble(asked: Assembling): Promise<Assembly | number> {
    const { root, label } = asked

    const entry = await firstPresent(root, CONVENTIONAL)

    // The endpoints FIRST, so everything under `/__abide/` is registered before a line of the app's
    // own module runs — an `onStart` that calls one of its own handlers is calling something that is
    // already there, and no file has to import another for its side effect.
    let answering: number
    try {
        answering = await handlers(root)
    } catch (failure) {
        console.error(`${label}: a handler did not load — ${messageOf(failure)}`)
        return CLI_EXIT_CODES.failed
    }

    // No module is an app that said nothing about itself, which is every default: no route of its
    // own, no hooks, and the pages and endpoints below unchanged by its absence.
    let declared: Route | null = null
    if (entry !== null) {
        let app: AppModule
        try {
            app = (await import(Bun.pathToFileURL(entry).href)) as AppModule
        } catch (failure) {
            // The import ran the app's module body, so this is as likely to be the app's own top-level
            // work failing as it is to be a syntax error. Either way it never bound a socket.
            console.error(`${label}: ${entry} did not load — ${messageOf(failure)}`)
            return CLI_EXIT_CODES.failed
        }
        const wired = wire(app)
        if (typeof wired === 'string') {
            console.error(`${label}: ${entry} ${wired}`)
            return CLI_EXIT_CODES.failed
        }
        declared = wired
    }

    // The pages and the document they render in — both read ONCE, here, because neither can change
    // under a running process and a shell parsed per request would be a file re-read per page view.
    // The bundle is settled first because the shell is where its names are read.
    let paged: Paged | null
    let serving: Route
    let built: LoadedClient | null
    try {
        built = isThenable(asked.client) ? await asked.client : asked.client
        paged = await pageLayer(root, built?.manifest ?? null, asked.head)
        serving = composed(declared, paged, built?.manifest ?? null)
    } catch (failure) {
        // An `app.html` with nowhere to render is the loud one, and it is caught HERE rather than on
        // the first page view: a shell somebody mistyped should be a process that does not come up.
        console.error(`${label}: ${messageOf(failure)}`)
        return CLI_EXIT_CODES.failed
    }

    // Nothing to serve, nothing to answer and nothing said: a command pointed at the wrong directory,
    // which is the case the missing-`app.ts` refusal was really about. Asked of what was FOUND rather
    // than of the file that used to stand for all three — the scan and the page layer have both run,
    // so this is the app's own emptiness rather than a stat guessing at it.
    //
    // The scan's own count rather than the registry's, which holds this COMMAND's endpoints too:
    // `abide dev` registers its reload socket before assembling, and an empty directory reading as
    // "1 socket" is a supervisor watching a tree with nothing in it.
    if (entry === null && paged === null && answering === 0) {
        console.error(`${label}: no app here — nothing to serve in ${root}`)
        const transports = Object.values(TRANSPORT_ROOTS).join(', ')
        console.error(`       an app is a ${PAGES}/ directory, handlers under ${transports}, or one of`)
        console.error(`       ${CONVENTIONAL.join(', ')} exporting its hooks`)
        return CLI_EXIT_CODES.usage
    }

    const handled = handle(serving)
    const assets = built?.assets ?? null
    // Two shapes rather than one that tests `assets` per request: a process either has a bundle for
    // its whole life or it does not, and this is the outermost function on every request the app
    // takes.
    //
    // The asset route is IN FRONT of the compressor and deliberately: a bundle was compressed once at
    // build time and its sidecar is already chosen by the same header — running it through a second
    // compressor would spend cpu per request to make brotli bytes bigger.
    const answer: Answer =
        assets === null
            ? (request: Request, server: Parameters<typeof handled>[1]): ReturnType<typeof handled> =>
                  compressing(request, handled(request, server))
            : (request: Request, server: Parameters<typeof handled>[1]): ReturnType<typeof handled> =>
                  assets.serve(request) ?? compressing(request, handled(request, server))

    return { entry, paged, assets, answer }
}

// --- the pages, and the document they are served in --------------------------

/** The pages and the document they render in. One value, because neither is read without the other. */
interface Paged {
    table: RouteEntry[]
    shell: AppShell
}

/**
 * The pages directory as a route table and the shell it renders in, or `null` when this app has none.
 *
 * `null` rather than an empty table, because the two mean different things to everything downstream:
 * no directory is an app made of endpoints and needs no shell, where an empty one is an app whose
 * pages have not been written yet and should still serve its own document.
 */
async function pageLayer(
    root: string,
    manifest: ClientManifest | null,
    head: string | undefined,
): Promise<Paged | null> {
    const directory = `${root}/${PAGES}`
    try {
        if (!(await Bun.file(directory).stat()).isDirectory()) return null
    } catch {
        return null
    }
    const shell = await appShell(root, manifest, appName())
    // `head` is BY DEFINITION the text before `</head>`, so appending lands exactly where a second
    // scan for `</head>` would have. After the stylesheets `appShell` already appended, which is what
    // keeps a dev client from being the thing that decides where an app's own css goes.
    if (head !== undefined) shell.parts.head += head
    return { table: await pages(directory), shell }
}

/**
 * The app's own route with the pages behind it, or whichever of the two exists.
 *
 * The app goes FIRST and `undefined` is what hands over, which is the same word `handle` reads as a
 * 404 — so an app that wants a path the pages directory also claims simply answers it, and one that
 * wants none writes no default export at all. Composed once at boot: an app with no route of its own
 * gets the renderer itself, rather than a wrapper testing for it per request.
 */
function composed(declared: Route | null, paged: Paged | null, manifest: ClientManifest | null): Route {
    // Nothing of its own and nothing to render: every path is then `handle`'s 404, which is an app
    // made entirely of endpoints.
    if (paged === null) return declared ?? ((): undefined => undefined)
    routes(paged.table)
    const rendered = renderer(paged.shell.parts, shellsPerRoute(paged, manifest))
    if (declared === null) return rendered
    return (request: Request, server: Parameters<Route>[1]): ReturnType<Route> => {
        const answered = declared(request, server)
        if (answered === undefined) return rendered(request)
        if (isThenable(answered)) return answered.then((settled) => settled ?? rendered(request))
        return answered
    }
}

/**
 * The document each route is served in, with that route's own chunks named in its head.
 *
 * Per ROUTE and built once, because a route table is fixed at boot and so is the set of files each
 * route reaches: computing this per request would be a graph walk and a string concat on the hottest
 * path this binary has, to produce the same head every time. What a request pays is a map lookup.
 *
 * The preload is what stops splitting costing a second serial round trip. A page reached through
 * `() => import(…)` is deliberately absent from the first load — that is the whole point of a loader
 * — but the browser cannot discover it until the entry has downloaded, parsed and RUN far enough to
 * reach the call. Naming it in the head makes the two fetches overlap instead, which is the one
 * change here that moves time-to-interactive rather than time-to-content.
 *
 * `modulepreload` and not `preload`: the two differ by more than a word — this one tells the browser
 * the bytes are a MODULE, so it parses and instantiates them and pulls in their static imports rather
 * than parking bytes in a cache for a second discovery to hit.
 */
function shellsPerRoute(paged: Paged, manifest: ClientManifest | null): Map<string, Shell> {
    const perRoute = new Map<string, Shell>()
    const graph = manifest?.graph
    if (graph === undefined) return perRoute

    for (const entry of paged.table) {
        const source = entry.source
        if (source === undefined) continue
        // The table's paths are relative to the pages DIRECTORY and the graph is keyed from the
        // project root, which is the seam where the two halves meet: `pages()` read a directory and
        // cannot know where it sits, and the bundler recorded what it was pointed at.
        const named: string[] = []
        for (const file of source.layouts) reachable(graph, `${PAGES}/${file}`, named)
        reachable(graph, `${PAGES}/${source.page}`, named)
        if (named.length === 0) continue

        let links = ''
        const at = mounted(CLIENT_ROUTE)
        for (const name of named) links += `<link rel="modulepreload" href="${at}${name}">`
        // A shallow copy per ROUTE, not per request: `open` and `close` are the same strings every
        // route is served with, and only the head differs.
        perRoute.set(entry.path, { ...paged.shell.parts, head: paged.shell.parts.head + links })
    }
    return perRoute
}

/**
 * The chunk holding `file`, and every chunk it STATICALLY imports, appended to `named` without
 * repeats.
 *
 * Transitive because a chunk whose own imports are not named is a chunk that downloads and then
 * blocks on discovering them — one round trip traded for another. Static only: a `dynamic-import`
 * edge is a chunk the browser fetches if it ever gets there, and following those would pull the whole
 * route table into the first load, undoing the splitting this exists to make cheap.
 *
 * The `named` array doubles as the seen-set. A route reaches a handful of chunks and its layouts
 * share most of them, so a linear scan over what is already there beats a `Set` allocated per route.
 */
function reachable(graph: ClientGraph, file: string, named: string[]): void {
    const held = graph.modules[file]
    // Already named is already CLOSED over: every entry the loop below appends is walked by that same
    // loop before the call returns, so nothing reachable from `held` can be missing. Returning here is
    // what keeps the COMMON case cheap — a page and its layouts share most of their chunks, and
    // re-entering the walk would re-enumerate a subtree already entirely in `named`.
    if (held === undefined || named.indexOf(held) !== -1) return
    let at = named.length
    named.push(held)
    // Index-based and re-reading `length`: entries are appended as the walk runs, which is what makes
    // this a breadth-first close over the graph rather than a recursion carrying its own stack.
    for (; at < named.length; at++) {
        const imports = graph.imports[named[at] as string]
        if (imports === undefined) continue
        for (const name of imports) if (named.indexOf(name) === -1) named.push(name)
    }
}

/**
 * One page, in the app's shell.
 *
 * There is nothing to match: `handle` opened the request scope, so `route()` already answers off this
 * request's own URL — which is why a page is served without the app writing a router, and why the
 * same `outlet()` renders here and hydrates in the browser.
 *
 * STREAMED, so a browser has the head and can start fetching the bundle while the body is still being
 * written. The scope follows it: the ambients ride the async context an `await` already carries, and
 * `documentToStream` holds the scope itself until the last chunk, so a `memo` read halfway down the
 * page is still this caller's one cache rather than a second build of the same answer.
 */
function renderer(
    shell: Shell,
    perRoute: Map<string, Shell>,
): (request: Request) => Promise<Response | undefined> {
    return async (request: Request): Promise<Response | undefined> => {
        // A page is a READ. Anything else against the same path is the app's to answer, and a 404
        // when it did not.
        if (request.method !== 'GET' && request.method !== 'HEAD') return undefined
        // `kind`, which is the router's own word for "nothing matched" — the empty name it is derived
        // from is that module's encoding rather than a fact this one may read.
        const asked = routeAsked()
        if (asked.kind === 'missing') return undefined

        // The page's module, before the walk that renders it: a render is a snapshot, and a module
        // that has not arrived is not a tree. `readying` rather than `ready`, because after the first
        // view of a route there is nothing left to load — and an `await` on the settled promise
        // `ready()` hands back would be a microtask tick charged to every page this process serves.
        const loading = readying()
        if (loading !== null) await loading

        // A client-side navigation asked for this page, and it is already looking at the document —
        // so what it needs is the outlet and not a second head, a second shell or a second copy of
        // every `<script>` it has already run. The same walk with the same options either way: the
        // markup a navigation adopts has to be the markup it would have hydrated.
        //
        // This branch is the ONLY thing a navigation changes on the server. It is reached through the
        // app's middleware exactly as a full page load is, because it IS a full page load as far as
        // everything above here is concerned — same path, same scope, same onion.
        if (request.headers.get(NAVIGATION_HEADER) !== null) {
            return page(fragmentToStream(outlet, HYDRATABLE), { headers: NAVIGATION_HEADERS })
        }

        // This route's own document — the shell with its chunks named in the head. One map lookup,
        // and the shared shell for a route the build knew nothing about.
        return page(documentToStream(perRoute.get(asked.name) ?? shell, outlet, HYDRATABLE))
    }
}

/**
 * What marks a navigation's answer, and what stops a cache from serving it to a page load.
 *
 * `Vary` is not optional here: two callers ask for ONE url and get a document or a fragment depending
 * on a request header, and a shared cache that missed that would serve a fragment to a browser
 * opening the page cold — a blank window with the head missing. The mark itself is what the client
 * tells the two apart by, because an app's own route may answer the same path with anything.
 */
const NAVIGATION_HEADERS: Record<string, string> = {
    [NAVIGATION_HEADER]: '1',
    vary: NAVIGATION_HEADER,
}

// --- compressing what the app answered ---------------------------------------

/** The one encoding offered. See `compressed` for why the asset route's brotli is not here. */
const RESPONSE_ENCODINGS = ['gzip']

/**
 * The answer, compressed when it is markup and the caller takes it.
 *
 * Here rather than in `page()` for two reasons that point the same way: `$server/responses.ts` is
 * bundled for the BROWSER — the example's server suite renders in a card — so it cannot reach a
 * compressor at all, and a rule that only covered the documents abide itself builds would leave an
 * app's own `text/html` route uncompressed for no reason a reader could name.
 *
 * `undefined` is `handle`'s 404 and passes straight through; a settled response is the common shape
 * and is not awaited, because a page render that did not have to wait returns one.
 */
function compressing(
    request: Request,
    answered: Response | Promise<Response | undefined> | undefined,
): Response | Promise<Response | undefined> | undefined {
    if (answered === undefined) return undefined
    if (isThenable(answered)) {
        return answered.then((settled) => (settled === undefined ? undefined : compressed(request, settled)))
    }
    return compressed(request, answered)
}

/**
 * The size at which an answer that is not markup is worth a compressor.
 *
 * The rule below used to be markup-only, on the premise that "everything else an endpoint answers is
 * small enough that a compressor per request is the more expensive half". That is right for the
 * answers it was written about and WRONG for the one that motivated this: an rpc returning a list a
 * page then filters in the browser served 637,179 bytes where gzip is 80,464 — 7.9x, on a payload
 * whose whole purpose is to cross the wire once and be worked on client-side.
 *
 * So the premise is kept where it holds and bounded by a number. Below this an answer saves a couple
 * of KB at best and still pays the compressor; above it the saving grows with the body.
 */
const COMPRESSIBLE_BYTES = 4096

/**
 * One response, compressed or handed back as it is.
 *
 * Markup at any size, streamed through a sync-flushed gzip so the parser still gets the head early.
 * `application/json` when its bytes exceed `COMPRESSIBLE_BYTES`, buffered — it is already a string in
 * memory, and the compressor is about to read all of it anyway. The asset route is in front of this
 * because its bytes were compressed once at build time.
 *
 * `vary` goes on even when this hands the bytes back untouched, for the reason the asset route says
 * it: the header describes what the ANSWER depends on, and a shared cache that stored the identity
 * form without it would go on serving those bytes to a caller that asked for gzip. That is what the
 * rebuild on the identity path buys — one `Response` and one header copy per page, against a cache
 * that hands compressed bytes to a caller that cannot read them.
 */
function compressed(request: Request, response: Response): Response | Promise<Response> {
    const type = response.headers.get('content-type')
    if (type === null) return response
    // Nothing to compress, and nothing a `Vary` would protect: a HEAD, a 204 and a 304 all carry no
    // body, and rebuilding one would be a `Response` per request for no bytes.
    if (response.body === null) return response
    // An app that compressed its own answer means it.
    if (response.headers.get('content-encoding') !== null) return response
    // An ALLOW-LIST on purpose: `content-length` cannot decide this, because a handler returns a
    // `Response` built from a string and the runtime writes the length at the socket, so the header is
    // absent on the object this sees and every buffered answer reads as a stream. The type is what
    // distinguishes the two — and naming the one that MAY be buffered is safer than naming the framed
    // ones to exclude, because a framing added later then defaults to being left alone. `NDJSON_TYPE`,
    // `JSONL_TYPE` and `text/event-stream` are absent for that reason: each is framed so a browser can
    // read it as it arrives, and buffering one to measure it would undo the framing.
    const markup = type.startsWith('text/html')
    if (!markup && !type.startsWith(JSON_TYPE)) return response

    const headers = new Headers(response.headers)
    // Appended rather than set: the navigation branch above already varies on its own header, and a
    // response that varies on two things has to say both or a cache picks one.
    headers.append('vary', 'accept-encoding')
    const init: ResponseInit = { status: response.status, statusText: response.statusText, headers }
    // Tested BEFORE either arm reads a body: this asks about the REQUEST, so it is settled whatever the
    // size turns out to be, and a client that cannot read gzip would otherwise pay a full buffer and
    // copy of every JSON answer to measure something it was never going to act on.
    if (acceptedEncoding(request.headers.get('accept-encoding'), RESPONSE_ENCODINGS) < 0) {
        return new Response(response.body, init)
    }
    if (!markup) return buffered(response, headers, init)

    // SYNC-FLUSHED, which is the whole reason this is `node:zlib` rather than the web standard.
    // `CompressionStream('gzip')` holds its input until the source closes: a document whose head was
    // written immediately emitted 10 bytes — the gzip header — and nothing else until the last
    // deferred subtree settled. The out-of-order protocol in `MARKERS.ts` exists precisely so a
    // browser's parser gets the head early, and buffering the body would undo it. `Z_SYNC_FLUSH` ends
    // a block at every write, so the same document came out at 1 ms and 122 ms instead of only at the
    // end, for about five bytes per flush.
    const gzip = createGzip({ flush: constants.Z_SYNC_FLUSH })
    const bridged = Duplex.toWeb(gzip)
    // Not awaited: `pipeTo` settles when the whole body has been written, and what the runtime is
    // handed is the READ end, which it is already consuming. A rejection here is the caller having
    // gone away — the pipe reports that by erroring the readable the runtime holds, so there is
    // nothing for this to do with it but not become an unhandled rejection.
    void response.body.pipeTo(bridged.writable).catch(() => {})
    headers.set('content-encoding', 'gzip')
    // The length described the identity bytes and describes nothing now. The runtime drops it for a
    // chunked body as well, so this is belt-and-braces — kept where the matching `set` on the buffered
    // arm was dropped, because the two fail in opposite directions: a length the runtime overwrites is
    // waste, and a length that outlived its bytes is a client waiting for bytes never coming.
    headers.delete('content-length')
    return new Response(bridged.readable as unknown as ReadableStream<Uint8Array>, init)
}

/**
 * A buffered answer, gzipped WHOLE when it is big enough to be worth it.
 *
 * Whole rather than streamed, because the size is the decision and the size is not knowable until the
 * bytes are in hand — and they already are, since this shape is a `Response` built from a string. One
 * `Bun.gzipSync` beats a stream bridge here for the same reason the document needs the opposite: there
 * is no parser waiting on an early first byte, so there is nothing to flush for.
 *
 * The headers arrive already varied, from the one place `compressed` builds them — its only caller,
 * and past the point where a caller that cannot read gzip has been answered. The `vary` is on both
 * arms and on the under-threshold answer too: a shared cache that stored the identity form of an
 * answer under this threshold, unmarked, would hand those bytes to a caller that asked for gzip —
 * which is fine — but the same URL with different args can land on either side of the threshold, so
 * the header has to describe the answer rather than the rule.
 */
async function buffered(response: Response, headers: Headers, init: ResponseInit): Promise<Response> {
    // The IDENTITY size is measured because it is the DECISION — a branch, not a header — and it is
    // the whole reason this arm reads the body at all.
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength <= COMPRESSIBLE_BYTES) return new Response(bytes, init)
    headers.set('content-encoding', 'gzip')
    // The COMPRESSED size is not, and stating it here bought nothing: the runtime writes
    // `content-length` from the bytes it actually sends, overriding whatever these headers carry — a
    // stale one included. So the progress bar a caller gets is the runtime's doing, and this was a
    // number formatted into a string per compressed response for a header that was overwritten.
    return new Response(Bun.gzipSync(bytes), init)
}

// --- what an app's module says about itself ----------------------------------

/**
 * Every export this binary reads. `unknown` throughout, because a module is whatever it was written
 * as — the checks below are what turn that into the registrations and the route.
 */
interface AppModule {
    default?: unknown
    middleware?: unknown
    onStart?: unknown
    onStop?: unknown
    onError?: unknown
    onConfig?: unknown
    onHealth?: unknown
    onIdentity?: unknown
}

/**
 * Hand each export to the function of the same name, and answer with the app's route.
 *
 * A string back is a refusal naming what is wrong, and every export is checked BEFORE any of it takes
 * effect: an app that exported `middleware` as one function rather than an array should be told that
 * rather than have its auth rung silently not run. Wrong SHAPE is the failure worth catching here —
 * an export that is simply absent is an app that did not want that hook.
 *
 * `onConfig` is registered like the rest and lands before `boot` asks for the document, which is what
 * makes a config an app cannot resolve a process that never listens.
 */
function wire(app: AppModule): Route | null | string {
    const wrong: string[] = []
    const rungs = app.middleware
    if (rungs !== undefined && !Array.isArray(rungs)) wrong.push('`middleware` must be an array of rungs')
    for (const [name] of HOOKS) {
        const hook = app[name]
        if (hook !== undefined && typeof hook !== 'function') wrong.push(`\`${name}\` must be a function`)
    }
    // Last, so `wrong` is complete either way and one message carries every complaint.
    const route = routeOf(app.default)
    if (route === undefined) {
        wrong.push(
            '`export default` must be a route — `(request, server) => Response | undefined` — or `{ fetch }`',
        )
    }
    // `route === undefined` again rather than only `wrong.length`, because it is what narrows the
    // return below to a `Route` without a cast asserting what was just checked.
    if (wrong.length > 0 || route === undefined) return `exports what this cannot read: ${wrong.join('; ')}`

    if (Array.isArray(rungs)) middleware(...(rungs as Middleware[]))
    for (const [name, register] of HOOKS) {
        const hook = app[name]
        if (hook !== undefined) register(hook)
    }
    return route
}

/**
 * Every hook an app may export, beside the function it is handed to.
 *
 * ONE table rather than a list to validate against and a block to register from, because those two
 * kept in step by hand is exactly the failure this file exists to remove: a name added to one and
 * not the other is an export that checks out and is never registered, with nothing said about it.
 */
const HOOKS: readonly (readonly [keyof AppModule, (hook: unknown) => void])[] = [
    ['onStart', (hook) => onStart(hook as StartHook)],
    ['onStop', (hook) => onStop(hook as StopHook)],
    ['onError', (hook) => onError(hook as ErrorHook)],
    [
        'onConfig',
        (hook) => {
            // The schema rides on the hook, because `onConfig` takes two things and a module export
            // is one. An app that would rather say it in a sentence calls `onConfig(fn, { schema })`
            // itself at module scope — the registration is on `abide/server` and this is sugar over
            // it, exactly as `x.set(v)` stays spellable under the template sugar.
            const schema = (hook as { schema?: Schema<Config> }).schema
            onConfig(hook as ConfigDefaults, schema === undefined ? undefined : { schema })
        },
    ],
    ['onHealth', (hook) => onHealth(hook as HealthReporter)],
    ['onIdentity', (hook) => onIdentity(hook as IdentityResolver)],
]

/**
 * The default export as a route: the function, the `fetch` of an object, or nothing at all.
 *
 * `{ fetch }` is here because it is what Bun's own entry points look like, so an app run directly by
 * `bun` and one served by `abide start` read as one module. `null` is an app that exported no route —
 * legitimate, and made entirely of endpoints. `undefined` is an export that was something else.
 */
function routeOf(exported: unknown): Route | null | undefined {
    if (exported === undefined) return null
    if (typeof exported === 'function') return exported as Route
    if (typeof exported === 'object' && exported !== null) {
        const fetch = (exported as { fetch?: unknown }).fetch
        // Bound, because a method written on an object literal may read `this` — and a route reached
        // through a variable would then be the one thing in an app that works differently for having
        // been passed somewhere.
        if (typeof fetch === 'function') return (fetch as Route).bind(exported)
    }
    return undefined
}

// --- the arguments and the report --------------------------------------------

/**
 * The port a command line asked for: a number, `null` for nothing asked, a message for a mistake.
 *
 * `0` is a legal answer and means "whatever is free" — the kernel's own spelling, and what a test or
 * a container with a port already mapped for it wants. Everything else is checked as a PORT rather
 * than as a number, because `--port 70000` is a typo that would otherwise be found by a bind failing.
 *
 * Behind `portAsked`, which is what both commands call: they must not disagree about what a port IS.
 * They differ about what to do when one is TAKEN, which is a decision each makes afterwards.
 */
function portFrom(argv: string[]): number | null | string {
    let asked: number | null = null
    for (let at = 0; at < argv.length; at++) {
        const argument = argv[at] as string
        let raw: string | undefined
        if (argument === '--port') raw = argv[++at]
        else if (argument.startsWith('--port=')) raw = argument.slice('--port='.length)
        else return `unknown option \`${argument}\``
        if (raw === undefined) return '`--port` needs a number'
        const port = Number(raw)
        // The same predicate `PORT` is read against, so a number this refuses is not one an operator
        // can get past by spelling it as a variable, and vice versa.
        if (!isPort(port)) return `\`${raw}\` is not a port`
        asked = port
    }
    return asked
}

/**
 * The `--port` a command line asked for, APPLIED — or `false` for a refusal already printed.
 *
 * Written once for the same reason the assembly messages are: `abide start` and `abide dev` had the
 * parse, the two message lines and the env spelling each, and the usage line each command printed was
 * a second copy of the `args` its row in `COMMANDS` already carries. Two commands with one flag
 * between them is one of them drifting.
 *
 * Spelled as the VARIABLE, before anything resolves the document. `config()` is the one answer to what
 * this process is running on, so a flag that kept its own number beside it would be a second one — and
 * the app's own `PORT` default would go on being reported by `config().PORT` while the socket sat
 * somewhere else. Declared here, the flag beats an app's `onConfig` default exactly as an operator's
 * variable does, which is the same rule stated once.
 *
 * The REFUSAL is printed here and the exit code is not, because that is what the two commands differ
 * about: `abide start` returns one and `abide dev` posts it to a main thread. It goes through `refuse`
 * so the usage line is the `args` the help screen prints, rather than a second spelling of it beside
 * the code that reads the flag.
 */
export function portAsked(argv: string[], name: string): boolean {
    const asked = portFrom(argv)
    if (typeof asked === 'string') {
        refuse(name, asked)
        return false
    }
    if (asked !== null) process.env.PORT = String(asked)
    return true
}

/**
 * Two lines: where it is listening, and what it is serving.
 *
 * The URL is FIRST and on its own, because it is the one thing anybody reads — and because something
 * watching this process (a test, a supervisor, a dev script) should not have to parse a banner to
 * learn the address. The endpoint counts are on the second line for the question they answer: a
 * transport module that was never imported registers nothing, and `0 rpc` is what that looks like.
 */
export function report(url: string, assembly: Assembly, note?: string): void {
    const on = colored()
    // The address an operator should OPEN, which under a mount is not the socket's own: the server
    // binds an origin and the app is served under a path of it, so printing the origin sends a reader
    // to a 404 in their own app. `new URL` rather than concatenation — `url` ends in `/`.
    const at = new URL(mounted('/'), url).href
    console.log(`listening ${paint(at, BOLD, on)}`)

    // Named only when there is one. An app with no module of its own has nothing to say here, and a
    // line reading `app.ts` for a file that is not there is the one mistake this line exists to catch.
    const parts: string[] = []
    if (assembly.entry !== null) parts.push(basename(assembly.entry))
    const paged = assembly.paged
    if (paged !== null) {
        // The shell is named because it is the one convention an app can have without knowing: a
        // process saying `app.html` when the author wrote `App.html` is the shortest way to find out
        // that the file is not being read.
        const where = paged.shell.own ? APP_HTML : "abide's shell"
        parts.push(`${plural(paged.table.length, 'page')} in ${where}`)
    }
    const rpcs = registered('rpc').length
    const sockets = registered('socket').length
    // `rpc` is the one count with no plural, which is why this is not a loop over the three.
    if (rpcs > 0) parts.push(`${rpcs} rpc`)
    if (sockets > 0) parts.push(plural(sockets, 'socket'))
    const assets = assembly.assets
    parts.push(assets === null ? 'no client bundle' : `${plural(assets.count, 'file')} at ${CLIENT_ROUTE}`)
    if (note !== undefined) parts.push(note)
    console.log(paint(`  ${parts.join(' · ')}`, DIM, on))
}
