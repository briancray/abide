// HOW AN APP ANSWERS, given what it has. Two commands supply the parts — `abide start` off what
// the build wrote (38.6) and `abide dev` out of memory (38.17) — and the request path itself is
// this one, because a dev server that resolves an address differently from the served one is a
// bug a reader meets in production and never in development.
//
// WHAT WRAPS IT is `createApp.ts`: the `App` whose `fetch` opens the request's one scope (42.6) and
// runs the app's `middleware` (37.3) around this.

import {
    ABIDE_ADDRESS,
    BRIDGE_ADDRESS,
    CLIENT_ADDRESS,
    HEALTH_ADDRESS,
    LOGS_ADDRESS,
    MCP_ADDRESS,
    OPENAPI_ADDRESS,
    PRINCIPAL_ADDRESS,
    RPC_ADDRESS,
    SOCKET_ADDRESS,
} from '#shared/ADDRESSES.ts'
import { DEBUG_META } from '#shared/DEBUG_META.ts'
import { decodedOrKept } from '#shared/decodedOrKept.ts'
import { escapeAttribute } from '#shared/escapeText.ts'
import { type Failed, isFailed } from '#shared/Failed.ts'
import { RENDER_LOG } from '#shared/log.ts'
import { MOUNT_META } from '#shared/MOUNT_META.ts'
import { coversPrefix, firstMatch, partsOf } from '#shared/matchRoute.ts'
import { MOUNT, mounted } from '#shared/mount.ts'
import { NAVIGATION_HEADER } from '#shared/NAVIGATION_HEADER.ts'
import { RPC_SERVER } from '#shared/RPC_SERVER.ts'
import { refuse, notFound as refusedNotFound } from '#shared/refuse.ts'
import { arrive } from '#shared/route.ts'
import {
    parseRoutePattern,
    rankBySpecificity,
    type Segment,
} from '#shared/routePattern.ts'
import type { Rpc } from '#shared/rpc.ts'
import { rpcRequest } from '#shared/rpcRequest.ts'
import type { Socket } from '#shared/socket.ts'
import { answerRpc, type Mounted } from './answerRpc.ts'
import { answerBlobTagged, answerValue, contentEtag } from './answerValue.ts'
import { answerBridge } from './bridgeRelay.ts'
import { CLIENT_ENTRY } from './CLIENT_BUILD.ts'
import { compressDocument } from './compressDocument.ts'
import { answerLogs, answerMcp, openApi } from './generatedSurfaces.ts'
import { reportHealth } from './health.ts'
import { failureOf } from './hooks.ts'
import { MUX_ADMITTED } from './MUX_ADMITTED.ts'
import { chunksOf, type Manifest } from './manifestOf.ts'
import { ENCODINGS, negotiateEncoding } from './negotiateEncoding.ts'
import { callerOrMint, PRINCIPAL_HANDLERS } from './principal.ts'
import { type Component, composePage, headAnchor, render } from './render.ts'
import {
    adoptRequest,
    beginRender,
    currentRequestScope,
    writtenStatus,
} from './requestScope.ts'
import { seedFor } from './seedBuffer.ts'

// One row of the table the compiler writes to `<out>/server.ts`. The loader is a dynamic import
// so a page's markup is off the boot path until an address asks for it, which is the same reason
// the client table's loaders are (30.11).
type ServerRoute = {
    pattern: string
    load: () => Promise<{ default: Component }>
    // 35.1 — the layouts this page renders inside, outermost first, as the compiler found them.
    layouts: (() => Promise<{ default: Component }>)[]
    // 38.29 — the modules a browser loads at this address, the page's then its layouts', as keys
    // into the manifest `manifestOf` reads.
    clientModules: string[]
}

// 35.2 — an error page, and the directory it answers for.
type ServerError = Omit<ServerRoute, 'clientModules'>

type RankedError = ServerError & { segments: Segment[] }

type Ranked = RankedError & {
    // The document this route is painted into, with the tags that load the app already in its
    // head (38.23, 38.24) and the preloads for this route's own modules (38.29). One per route and
    // built at boot, so a request pays for none of it.
    document: string
}

/** A public file, read once at boot: where the bytes are, the etag off them, and its type. */
export type PublicFile = { path: string; etag: string; type: string }

/** Everything `answerRequest` answers from: the ranked routes, the lanes and the handlers. */
export type AppSources = {
    /** The routes in 30.9's order, which `appSources` is the only way to get. */
    routes: Ranked[]
    /**
     * Everything under `/__abide`: the bundle, and `abide dev`'s reload client beside it.
     *
     * The bundle is 38.21's and the reload client 38.18's. One lane rather than an asset table
     * plus an exception, so what a command answers there is a fact about the command.
     */
    framework: (pathname: string, request: Request) => Response | undefined
    /**
     * A file's address below `public`, to the file itself.
     *
     * 38.19 and 38.20 — from the built output for `abide start` and from the source tree for
     * `abide dev`.
     */
    published: Map<string, PublicFile>
    /** The error pages, deepest directory first. 35.2. */
    errors: RankedError[]
    /** The document the error pages are painted into. */
    errorDocument: string
    /** Every handler's address, to what answers it (`mountHandlers`). 16.2. */
    handlers: Map<string, Mounted>
    /**
     * Every socket the app mounts, by address, carried over the one mux `App.listen` binds.
     *
     * 18.2.
     */
    sockets: Map<string, Socket<unknown, unknown>>
    /**
     * The app's own route, asked where nothing of abide's answers.
     *
     * 37.2 — `bootApp` fills it from `src/server/app.ts`'s `default`.
     */
    own: ((request: Request) => Promise<Response | undefined>) | undefined
    /**
     * What a page that threw, unrefused, is answered with in place of 16.42's bare 500.
     *
     * 38.4 — `abide dev`'s document naming what broke, for the author looking at the browser.
     * `abide start` has none, and says nothing about itself to the caller.
     */
    explained: ((thrown: unknown) => Response) | undefined
}

/** What a command reads or compiles, before `bootApp` adds what the `App` itself supplies. */
export type LoadedSources = Omit<AppSources, 'own'>

/** The `Response` to one request: a handler, a surface of abide's own, a file, or a page. */
export async function answerRequest(
    app: AppSources,
    request: Request,
): Promise<Response> {
    // ONE SCOPE PER REQUEST (42.6): the one `App.fetch` opened, which every lane below reuses — and
    // which serves the request a `middleware` rung handed `next` where it made one of its own (37.3).
    adoptRequest(request)
    const url = new URL(request.url)
    const asked = url.pathname

    if (asked.startsWith(`${RPC_ADDRESS}/`))
        return answerRpc(app.handlers, url, request, (failure) =>
            answerFailure(app, asked, failure),
        )
    // 26.17 — the principal is a handler abide mounts, answered as the app's are.
    if (asked === PRINCIPAL_ADDRESS)
        return answerRpc(PRINCIPAL_HANDLERS, url, request, (failure) =>
            answerFailure(app, asked, failure),
        )
    // 25.1, 20.5, 20.9, 36.7 — a surface of abide's own, or a 404 where its `ABIDE_*` has not
    // opened it.
    const surface = SURFACES.get(asked)
    if (surface !== undefined) {
        const answer = await surface(app, request)
        if (answer === undefined) return notFound()
        // 21.4 — an answer about this process, or its surfaces, is never cached.
        return answerValue(
            answer,
            request,
            new Headers({
                'content-type': 'application/json',
                'cache-control': 'no-store',
            }),
            200,
        )
    }
    // 37.3 — THE MUX'S UPGRADE PASSES THE APP LANE as every request does, and arriving here is the
    // lane having let it through: `MUX_ADMITTED` is what the listener upgrades on, and whatever a rung
    // answered instead is sent as it was answered.
    if (
        asked === SOCKET_ADDRESS &&
        request.headers.get('upgrade') === 'websocket' &&
        (app.sockets.size > 0 || app.handlers.size > 0)
    )
        return new Response(null, { status: MUX_ADMITTED })
    if (asked.startsWith(`${ABIDE_ADDRESS}/`)) {
        const answer = app.framework(asked, request)
        if (answer === undefined) return notFound()
        return readsOnly(request) ? answer : methodRefused(app, asked)
    }

    // 36.11 — A PUBLIC FILE IS ITS PATH BELOW THE DIRECTORY, so `/favicon.ico` is answered
    // before any route is tried. The order is not load-bearing: `abide build` and `abide dev`
    // run `refuseAddressCollision` (36.13) over the same two trees before anything is served,
    // so at run time there can never be a collision to resolve. 36.11 — keyed by its name on disk
    // and asked for percent-encoded: `my photo.jpg` is `/my%20photo.jpg`.
    const file = app.published.get(decodedOrKept(asked))
    if (file !== undefined)
        return readsOnly(request)
            ? publicResponse(request, file)
            : methodRefused(app, asked)

    // 15.16 — an address that will not percent-decode names nothing, and is the caller's fault.
    const parts = partsOf(asked)
    if (parts === undefined)
        return answerFailure(
            app,
            asked,
            refuse(400, 'The address is not a valid path.'),
        )

    const found = firstMatch(app.routes, parts)
    // 38.22. The client router leaves an unmatched address to the document (30.10), so this
    // is where that address arrives — and where the app's own route is asked before the 404.
    if (found === undefined)
        return (
            (await app.own?.(request)) ??
            (await answerFailure(
                app,
                asked,
                refusedNotFound({ path: asked, method: request.method }),
            ))
        )

    if (!readsOnly(request)) return methodRefused(app, asked)

    // 30.16 — THE CLIENT ROUTER ASKING, not a reader loading the page. `middleware` has already run
    // over this request by the time it gets here, and it is what the router came for: a refusal
    // or a redirect it wrote. `stamp` puts that written status over this 204, and the router
    // carries the page's own markup, so there is nothing to render.
    if (request.headers.has(NAVIGATION_HEADER))
        return new Response(null, {
            status: 204,
            headers: { 'cache-control': 'no-store' },
        })

    // 33.4 — a prop is an ACCESSOR, which is the contract `renderComponent` renders a child under
    // and the one the client router mounts a page under; the params are the record `firstMatch`
    // hands the client for this same address.
    const bound = boundPage(found.route, { params: () => found.params })
    // 38.30 — `vary` WHETHER OR NOT THIS ONE IS COMPRESSED: the document is negotiated, and a cache
    // that stored the identity answer for a reader who sent no `accept-encoding` must not hand it
    // to one who did, nor the reverse.
    // 11.32 — the page renders in a scope of its own, so what its values hold is this request's —
    // and 41.13, every call it makes is left for the browser's own call to be answered from.
    const headers = new Headers(DOCUMENT_HEADERS)
    // THE HEADERS A `GET` WOULD CARRY, and no render for a body nobody is sent — nor a caller
    // minted for a request that never becomes a page.
    if (request.method === 'HEAD')
        return new Response(null, { status: writtenStatus(), headers })
    // 26.5 — the caller the seed buffer is keyed by, minted where the browser carries none: the same
    // one `principal.caller` reads for the rest of the request.
    const caller = callerOrMint()
    // 23.1 — WHERE THIS PAGE IS, for its setup to read, in the request's own instances (11.32).
    // 16.11 — AT THE ADDRESS IT IS SERVED AT, which is the one the browser's router arrives at: the
    // request reached here with the mount taken off, and a page reading `route.url()` on both sides
    // would otherwise render one address and hydrate against another.
    const at = new URL(request.url)
    at.pathname = mounted(at.pathname)
    arrive(at.href, found.route.pattern, found.params)
    beginRender({ seed: seedFor(caller), calls: [] })
    // 41.1, 35.2 — THE DOCUMENT IS THE BUILT PAGE, read whole before there is a `Response` to commit a
    // status to: a refusal the page read, or a throw, is answered by the nearest error page at its own
    // status rather than as a 200 the stream then abandons.
    let document: Uint8Array<ArrayBuffer>
    try {
        document = await render(bound, found.route.document)
    } catch (thrown) {
        const failure = failureOf(thrown)
        // Explained only where it was the server's fault — not a refusal, not a client that left.
        if (
            !isFailed(thrown) &&
            failure.status === 500 &&
            app.explained !== undefined
        )
            return app.explained(thrown)
        return answerFailure(app, asked, failure)
    }
    // 21.10, 22.9 — WHAT WAS WRITTEN THROUGH `response` BEFORE THE HEAD WENT OUT: a `middleware`
    // rung's, and the page's own setup's, the head going out with the built page.
    const status = writtenStatus()
    const encoding = negotiateEncoding(
        request.headers.get('accept-encoding'),
        ENCODINGS,
    )
    // THE LENGTH IS SAID, not left to the server to find: `abide dev` relays the body chunk by chunk
    // from its worker (38.36), and a relayed body with no declared length goes out chunked.
    let answered = document
    if (encoding !== undefined) {
        headers.set('content-encoding', encoding)
        answered = compressDocument(document, encoding)
    }
    headers.set('content-length', String(answered.byteLength))
    return new Response(answered, { status, headers })
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
function boundPage(
    page: Pick<Ranked, 'load' | 'layouts'>,
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

// THE ADDRESSES ABIDE ANSWERS ITSELF, looked up once rather than asked in turn: each to its value,
// a `Response` of its own, or `undefined` where its `ABIDE_*` has not opened it.
const SURFACES = new Map<
    string,
    (app: AppSources, request: Request) => unknown
>([
    [HEALTH_ADDRESS, reportHealth],
    [OPENAPI_ADDRESS, (app) => openApi(app.handlers)],
    [MCP_ADDRESS, (app, request) => answerMcp(app.handlers, request)],
    [LOGS_ADDRESS, (_app, request) => answerLogs(request)],
    [BRIDGE_ADDRESS, (_app, request) => answerBridge(request)],
])

// What a call made in a page's render reports into: the seed buffer (41.13), and — where the handler
// is mounted — the request the browser will make for it, for the early-call script (41.20). Once per
// render, as the browser's `Rpc` makes it once, and the seed buffer is what says which is the once.
RPC_SERVER.reached = (rpc, args, reached) => {
    const page = currentRequestScope()?.page
    if (page === undefined || !page.seed(rpc, args, reached)) return
    // 16.11 — the address the browser's own call is made at, stamped under the mount by
    // `mountHandlers` — and `undefined` on a handler nothing mounted.
    const { address, method } = rpc as Rpc<unknown, unknown>
    if (address === undefined) return
    page.calls.push(
        rpcRequest(
            method,
            address,
            args as Record<string, unknown> | undefined,
        ),
    )
}

// 21.3, 21.6, 21.18.
const DOCUMENT_HEADERS = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, no-store',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'content-security-policy': "frame-ancestors 'none'",
    vary: 'accept-encoding',
}

/**
 * What the compiler writes to `<out>/server.ts`: the routes and the error pages.
 *
 * Read off disk by `abide start` and out of memory by `abide dev`.
 */
export type ServerTable = { routes: ServerRoute[]; errors: ServerError[] }

/**
 * The sources both commands build alike, off the table, the shell and the bundle's manifest.
 *
 * What differs between them is passed in: the `framework` lane, and `head` — `abide dev`'s reload
 * client (38.18), after the app's own tags.
 *
 * 30.9 — MOST SPECIFIC FIRST, ranked off the table rather than in it. The ordering IS the client
 * router's own: both seams sort through `rankBySpecificity` and resolve through `firstMatch`, so
 * "the two cannot resolve one address differently" is a grep rather than a promise. 35.2 — the
 * error pages deepest directory first, so the nearest answers.
 */
export function appSources(
    table: ServerTable,
    shell: string,
    manifest: Manifest,
    head: string,
    parts: Pick<
        AppSources,
        'framework' | 'published' | 'handlers' | 'sockets' | 'explained'
    >,
): LoadedSources {
    const underMount = shellUnderMount(shell)
    const documentOf = (modules: string[]): string =>
        intoHead(underMount, clientTags(manifest, modules) + head)
    const routes: Ranked[] = []
    for (const route of table.routes)
        routes.push({
            pattern: route.pattern,
            segments: parseRoutePattern(route.pattern),
            load: route.load,
            layouts: route.layouts,
            document: documentOf(route.clientModules),
        })
    const errors: RankedError[] = []
    for (const error of table.errors)
        errors.push({ ...error, segments: parseRoutePattern(error.pattern) })
    errors.sort((a, b) => b.segments.length - a.segments.length)
    return {
        routes: rankBySpecificity(routes),
        errors,
        errorDocument: documentOf([]),
        ...parts,
    }
}

/**
 * The head tags that load the app: its metas, stylesheet, entry script and the route's preloads.
 *
 * 38.23, and 38.24 for the stylesheet beside it. An app does not write either: the bundle's
 * address is the build's, and a hand-written one is a path that goes stale the first time the
 * output layout moves.
 *
 * THE STYLESHEET GOES FIRST, and ahead of the page's own head contributions for the same reason:
 * a document that parses its script before its styles paints once unstyled. It is a plain `<link>`
 * rather than anything the client does, so a page the server painted is styled with no JS at all.
 *
 * ONE STYLESHEET FOR THE APP: the bundler collects every stylesheet reachable from the entry — each
 * component's scoped `<style>` (34.4) and each one a component imports (34.6) — into one file, so a
 * page that renders none of those components is served them too. For a `<style>` block that costs
 * bytes rather than correctness: every rule requires its component's scope token, so on a page the
 * component is not on it matches nothing. An imported stylesheet carries no token and applies as
 * written, wherever it is served.
 *
 * 38.29 — THE ROUTE'S CHUNKS ARE PRELOADED BESIDE THE ENTRY. Left to the client, the page's chunk
 * and the shared runtime it imports are only asked for once the entry has arrived and run the
 * router — a whole round trip after the document, for the largest file in the bundle. Named here,
 * they are requested while the document is still being parsed.
 *
 * EVERY NAME IS THE MANIFEST'S, the entry's included: a build hashes it (38.5). A manifest with no
 * entry is a bundle that failed under `abide dev` (38.18), and gets no tags rather than a
 * `<script>` at a 404.
 */
export function clientTags(manifest: Manifest, modules: string[]): string {
    if (manifest.entry === undefined) return ''
    // 28.10 — `DEBUG`, through the document rather than the bundle, where the server has one.
    const debug = process.env.DEBUG
    let tags =
        debug === undefined || debug === ''
            ? ''
            : `<meta name="${DEBUG_META}" content="${escapeAttribute(debug)}">`
    // 16.11 — the mount the browser resolves every address against, the root's `''` included: a
    // lookup that finds no tag has walked the whole document to say so.
    tags += `<meta name="${MOUNT_META}" content="${escapeAttribute(MOUNT.current())}">`
    const client = mounted(CLIENT_ADDRESS)
    tags +=
        manifest.stylesheet === undefined
            ? ''
            : `<link rel="stylesheet" href="${client}/${manifest.stylesheet}">`
    tags += `<script type="module" src="${client}/${manifest.entry}"></script>`
    for (const chunk of chunksOf([`${CLIENT_ENTRY}.ts`, ...modules], manifest))
        tags += `<link rel="modulepreload" href="${client}/${chunk}">`
    return tags
}

/**
 * The shell with every root-absolute `href` and `src` it writes put below the mount.
 *
 * 16.11, 36.11 — THE SHELL IS NOT A TEMPLATE, so it has no `url` to spell an address with, and the
 * `/fonts/…` it preloads is a public file answered below the mount. The same shell is every page's
 * at every depth, so a relative address is no spelling either. `//` is another host's.
 */
function shellUnderMount(shell: string): string {
    const root = mounted('/')
    return root === '/'
        ? shell
        : shell.replace(
              /\b(href|src)=(["'])\/(?!\/)/g,
              (_whole, name: string, quote: string) =>
                  `${name}=${quote}${root}`,
          )
}

/**
 * The shell with `tags` at the head anchor `render` uses.
 *
 * So a shell with no `</head>` puts them where its head content goes rather than inside the body.
 */
function intoHead(shell: string, tags: string): string {
    const at = headAnchor(shell)
    return shell.slice(0, at) + tags + shell.slice(at)
}

/**
 * The public files by address, off each file's name and where its bytes are.
 *
 * 38.19 and 38.20's directory, as an address per file — or a compiled app's, whose bytes are
 * inside itself. Read at boot rather than per request, and the ETAG IS READ WITH IT: 21.13
 * derives it from the bytes, so there is no cheaper moment than the one read that is happening
 * anyway. The bytes are hashed and dropped — `Bun.file` streams the body when somebody asks, so a
 * large file is not held in memory for the life of the process.
 */
export async function publicFilesAt(
    paths: Map<string, string>,
): Promise<Map<string, PublicFile>> {
    const files = new Map<string, PublicFile>()
    // THE READS OVERLAP. They are independent, and `abide dev` runs this again on every
    // reload rather than once at boot — so it is reload latency an author waits on, not just
    // a boot cost. Each is hashed as it lands, so no more than the reads in flight are held.
    const names = [...paths.keys()]
    const etags = await Promise.all(
        names.map(async (name) =>
            contentEtag(await Bun.file(paths.get(name) as string).bytes()),
        ),
    )
    for (let index = 0; index < names.length; index += 1) {
        const name = names[index] as string
        files.set(`/${name}`, {
            path: paths.get(name) as string,
            etag: etags[index] as string,
            type: publicType(name),
        })
    }
    return files
}

/**
 * A public file's content type, off its name's extension.
 *
 * 36.14, 36.17 — a text type without a charset is given UTF-8's rather than whatever a browser
 * guesses.
 */
function publicType(name: string): string {
    const type = Bun.file(name).type
    return type.startsWith('text/') && !type.includes('charset')
        ? `${type}; charset=utf-8`
        : type
}

/**
 * A plain-text answer at `status`, never stored.
 *
 * 21.3 — A REFUSAL ABIDE ANSWERS AS TEXT, typed. `stamp` rebuilds an answer to give it a reason
 * phrase (17.8), and a string body rebuilt goes out as `application/octet-stream`.
 */
export function plainAnswer(message: string, status: number): Response {
    return new Response(message, {
        status,
        headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'private, no-store',
        },
    })
}

function notFound(): Response {
    return plainAnswer('not found', 404)
}

/** Whether the request only reads: a `GET` or a `HEAD`. 15.17. */
function readsOnly(request: Request): boolean {
    return request.method === 'GET' || request.method === 'HEAD'
}

async function methodRefused(
    app: AppSources,
    pathname: string,
): Promise<Response> {
    const answer = await answerFailure(app, pathname, refuse(405))
    answer.headers.set('allow', 'GET, HEAD')
    return answer
}

/**
 * A public file's answer, conditional and range-aware off the etag read at boot.
 *
 * 21.14 and 16.36's range, answered before a byte is read. 36.12 and 36.14 — the bytes as
 * authored, and the content-type off the extension, which is what `Bun.file` already derives
 * rather than a table kept here.
 */
function publicResponse(request: Request, file: PublicFile): Response {
    return answerBlobTagged(
        Bun.file(file.path, { type: file.type }),
        file.etag,
        request,
        // 21.12. Revalidated every time and cached in between, which is what an unhashed name
        // earns — the etag is what makes that one conditional request rather than one transfer.
        new Headers({ 'cache-control': 'public, max-age=0, must-revalidate' }),
        200,
    )
}

/**
 * The error pages for `pathname`, nearest first.
 *
 * 35.2 — every one whose directory is a prefix of the address, each segment meaning what it means
 * in a route.
 */
function errorsFor(errors: RankedError[], pathname: string): RankedError[] {
    // 15.16's address has no parts to be nearest to, so the root's page paints it.
    const parts = partsOf(pathname) ?? []
    const found: RankedError[] = []
    for (const error of errors)
        if (coversPrefix(error.segments, parts)) found.push(error)
    return found
}

/**
 * A refusal, painted by the nearest error page at the refusal's own status.
 *
 * 35.2, 35.3 — the page is rendered whole before a byte is answered, so one that fails is not
 * half-sent: it escalates to the next ancestor, and says so on `abide:render`. With none left,
 * the refusal is answered as text.
 */
async function answerFailure(
    app: AppSources,
    pathname: string,
    failure: Failed<string, unknown>,
): Promise<Response> {
    const headers = new Headers(DOCUMENT_HEADERS)
    const status = failure.status
    for (const error of errorsFor(app.errors, pathname)) {
        try {
            const bound = boundPage(error, { failure: () => failure })
            beginRender(undefined)
            const document = await render(bound, app.errorDocument)
            return new Response(document, { status, headers })
        } catch (thrown) {
            RENDER_LOG.warning(
                `the error page for ${error.pattern} failed, so the next one answers`,
                thrown,
            )
        }
    }
    headers.set('content-type', 'text/plain; charset=utf-8')
    return new Response(failure.message, { status, headers })
}
