// HOW AN APP ANSWERS, given what it has. Two commands supply the parts — `abide start` off what
// the build wrote (38.6) and `abide dev` out of memory (38.16) — and the request path itself is
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
    MCP_ADDRESS,
    OPENAPI_ADDRESS,
} from '#shared/ADDRESSES.ts'
import { APP_META } from '#shared/APP_META.ts'
import { DEBUG_META } from '#shared/DEBUG_META.ts'
import { decodedOrKept } from '#shared/decodedOrKept.ts'
import { escapeAttribute } from '#shared/escapeText.ts'
import { type Failed, isFailed } from '#shared/Failed.ts'
import { health } from '#shared/health.ts'
import { appName } from '#shared/log.ts'
import { compose } from '#shared/Middleware.ts'
import { MOUNT_META } from '#shared/MOUNT_META.ts'
import { matchOf, type Params, partsOf } from '#shared/matchRoute.ts'
import { MOUNT, mounted } from '#shared/mount.ts'
import { NAVIGATION_HEADER } from '#shared/NAVIGATION_HEADER.ts'
import { refuse, notFound as refusedNotFound } from '#shared/refuse.ts'
import { arrive } from '#shared/route.ts'
import {
    parseRoutePattern,
    rankRoutes,
    type Segment,
} from '#shared/routePattern.ts'
import type { Method, Rpc } from '#shared/rpc.ts'
import { rpcRequest } from '#shared/rpcRequest.ts'
import { answered, answerFailure } from './answerFailure.ts'
import {
    answerRpc,
    type Mounted,
    type MountRow,
    mountedOwn,
    mountHandlers,
} from './answerRpc.ts'
import { answerBlobTagged, answerValue, contentEtag } from './answerValue.ts'
import { answerBridge } from './bridgeRelay.ts'
import { CLIENT_ENTRY } from './CLIENT_BUILD.ts'
import { callerOrMint } from './callerOf.ts'
import { compressAnswer } from './compressAnswer.ts'
import { DOCUMENT_HEADERS } from './DOCUMENT_HEADERS.ts'
import { answerMcp, openApi } from './generatedSurfaces.ts'
import { type AppRung, failureOf, rungsOver } from './hooks.ts'
import { chunksOf, type Manifest } from './manifestOf.ts'
import { muxAdmission } from './muxUpgrade.ts'
import { plainAnswer } from './plainAnswer.ts'
import { prefers } from './prefers.ts'
import { PRINCIPAL_MOUNT } from './principal.ts'
import {
    boundPage,
    type Component,
    DEFAULT_DOCUMENT,
    intoHead,
    renderDocument,
} from './render.ts'
import {
    type AnsweringApp,
    adoptRequest,
    beginRender,
    currentRequestScope,
    type RequestScope,
    within,
    writtenStatus,
} from './requestScope.ts'
import { seedFor } from './seedBuffer.ts'

// One row of the server's table the compiler writes (`SERVER_TABLE`). The loader is a dynamic import
// so a page's markup is off the boot path until an address asks for it, which is the same reason
// the client table's loaders are (30.11).
type ServerRoute = {
    pattern: string
    load: () => Promise<{ default: Component }>
    // 35.1 — the layouts this page renders inside, outermost first, as the compiler found them.
    layouts: (() => Promise<{ default: Component }>)[]
    // 38.28 — the modules a browser loads at this address, the page's then its layouts', as keys
    // into the manifest `manifestOf` reads.
    clientModules: string[]
}

// 35.2 — an error page, and the directory it answers for.
type ServerError = Omit<ServerRoute, 'clientModules'>

type RankedError = ServerError & { segments: Segment[] }

type Ranked = RankedError & {
    // The document this route is painted into, with the tags that load the app already in its
    // head (38.22, 38.23) and the preloads for this route's own modules (38.28). One per route and
    // built at boot, so a request pays for none of it.
    document: string
}

/**
 * One route of the app: the page at it, and the handler answering each method there.
 *
 * 19.1 — one file per method per route, so a route is a row and a method is a column, and 19.21's
 * "the most specific route answering the method" is a walk down the rows asking each column.
 */
type RouteRow = {
    pattern: string
    segments: Segment[]
    page: Ranked | undefined
    handlers: Map<Method, Mounted>
    /**
     * The page and each handler, keyed by itself, inside the rungs its file's route filed (37.2).
     *
     * 16.14 — composed once with the table. Every server block is imported before it is built
     * (37.1), so these are the rungs the boot found, as the root's are.
     */
    answers: Map<
        Ranked | Mounted,
        (ctx: { request: Request }) => Promise<Response>
    >
}

/** A public file, read once at boot: where the bytes are, the etag off them, and its type. */
type PublicFile = { path: string; etag: string; type: string }

/** Everything `answerRequest` answers from: the ranked routes, the lanes and the handlers. */
export type AppSources = {
    /** The routes, pages and handlers both, in 30.9's order, which `appSources` is the only way to get. */
    routes: RouteRow[]
    /**
     * Everything under `/__abide`: the bundle, and `abide dev`'s reload client beside it.
     *
     * The bundle is 38.20's and the reload client 38.17's. One lane rather than an asset table
     * plus an exception, so what a command answers there is a fact about the command.
     */
    framework: (pathname: string, request: Request) => Response | undefined
    /**
     * A file's address below `public`, to the file itself.
     *
     * 38.18 and 38.19 — from the built output for `abide start` and from the source tree for
     * `abide dev`.
     */
    published: Map<string, PublicFile>
    /** The error pages, deepest directory first. 35.2. */
    errors: RankedError[]
    /** The document the error pages are painted into. */
    errorDocument: string
    /** Every handler, keyed by its method and address (`handlerKey`), to what answers it. 16.2. */
    handlers: Map<string, Mounted>
    /**
     * What a page that threw, unrefused, is answered with in place of 16.41's bare 500.
     *
     * 38.4 — `abide dev`'s document naming what broke, for the author looking at the browser.
     * `abide start` has none, and says nothing about itself to the caller.
     */
    explained: ((thrown: unknown) => Response) | undefined
}

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
    const method = request.method === 'HEAD' ? 'GET' : request.method

    // 25.1, 25.3, 26.17 — the principal and the account of the app are handlers abide mounts,
    // answered as the app's are.
    const own = OWN_HANDLERS.get(asked)
    if (own !== undefined)
        return own.method === method
            ? answerRpc(own, {}, url, request, app)
            : methodRefused(app, asked, [own.method])
    // 20.5, 20.9, 36.7 — a surface of abide's own, or a 404 where it answers nothing.
    const surface = SURFACES.get(asked)
    if (surface !== undefined) {
        const answer = await surface(app, request)
        if (answer === undefined) return notFound()
        // 21.4 — an answer about the app's surfaces is never cached.
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
    // 37.3 — THE MUX'S UPGRADE PASSES THE APP LANE as every request does (`muxUpgrade`).
    const admitted = muxAdmission(asked, request, app)
    if (admitted !== undefined) return admitted
    if (asked.startsWith(`${ABIDE_ADDRESS}/`)) {
        const answer = app.framework(asked, request)
        if (answer === undefined) return notFound()
        return readsOnly(request) ? answer : methodRefused(app, asked, READS)
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
            : methodRefused(app, asked, READS)

    // 15.16 — an address that will not percent-decode names nothing, and is the caller's fault.
    const parts = partsOf(asked)
    if (parts === undefined)
        return answerFailure(
            app,
            asked,
            refuse(400, 'The address is not a valid path.'),
        )

    // 19.21 — THE MOST SPECIFIC ROUTE ANSWERING THE METHOD, an `OPTIONS` asking about the method
    // its preflight names (16.24). A route that matches and answers some other method is held, so
    // an address nothing answers the method at is a 405 naming what is answered there (15.17).
    const preflight = request.method === 'OPTIONS'
    // `null` for an `OPTIONS` that names no method, which is no preflight (Fetch's CORS-preflight
    // request carries one) and so no handler's: the route answers 15.17's 405 with what it allows.
    const asking = preflight
        ? request.headers.get('access-control-request-method')
        : method
    let allowed: Set<string> | undefined
    let found:
        | { route: RouteRow; params: Params; handler: Mounted | undefined }
        | undefined
    for (const route of app.routes) {
        const params = matchOf(route.segments, parts)
        if (params === undefined) continue
        const handler =
            asking === null ? undefined : route.handlers.get(asking as Method)
        if (
            handler !== undefined ||
            (!preflight && asking === 'GET' && route.page !== undefined)
        ) {
            found = { route, params, handler }
            break
        }
        allowed ??= new Set()
        if (route.page !== undefined) allowed.add('GET').add('HEAD')
        for (const method of route.handlers.keys()) {
            allowed.add(method)
            if (method === 'GET') allowed.add('HEAD')
        }
    }
    if (found === undefined) {
        if (allowed !== undefined)
            return methodRefused(app, asked, [...allowed], request)
        // 38.21. The client router leaves an unmatched address to the document (30.10), so this
        // is where that address arrives. An app answering one itself does it in a root rung (37.3),
        // which ran before this.
        return laneFailure(
            app,
            asked,
            refusedNotFound({ path: asked, method: request.method }),
            request,
        )
    }
    // 37.2, 37.5 — WHAT THE FILE'S ROUTE FILED: the request runs inside every rung filed at it or
    // above it, the root's having run already, and an error in it reaches that route's `onError`.
    const scope = currentRequestScope() as RequestScope
    scope.route =
        found.handler === undefined ? found.route.pattern : found.handler.route
    scope.params = found.params
    const answer = found.route.answers.get(
        found.handler ?? (found.route.page as Ranked),
    ) as (ctx: { request: Request }) => Promise<Response>
    return answer({ request })
}

/**
 * The answer of `found`, a page or a handler, once its middleware has admitted `request`, with the
 * params routing put on the request's scope.
 */
async function answerMatched(
    app: AppSources,
    request: Request,
    found: Ranked | Mounted,
): Promise<Response> {
    // 37.2 — a route's rung may hand `next` a request of its own, adopted as a root rung's is.
    adoptRequest(request)
    const url = new URL(request.url)
    const asked = url.pathname
    const params = (currentRequestScope() as RequestScope).params as Params
    if ('handler' in found) return answerRpc(found, params, url, request, app)
    const page = found

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
    const bound = boundPage(page, { params: () => params })
    // 38.29 — `vary` WHETHER OR NOT THIS ONE IS COMPRESSED: the document is negotiated, and a cache
    // that stored the identity answer for a reader who sent no `accept-encoding` must not hand it
    // to one who did, nor the reverse.
    const headers = new Headers(DOCUMENT_HEADERS)
    // THE HEADERS A `GET` WOULD CARRY, and no render for a body nobody is sent — nor a caller
    // minted for a request that never becomes a page.
    if (request.method === 'HEAD')
        return new Response(null, { status: writtenStatus(), headers })
    // 26.5 — the caller the seed buffer is keyed by, minted where the browser carries none: the same
    // one `principal.caller` reads for the rest of the request.
    const caller = callerOrMint()
    // 23.1 — WHERE THIS PAGE IS, for its setup to read, in the request's own instances (11.32).
    // 16.10 — AT THE ADDRESS IT IS SERVED AT, which is the one the browser's router arrives at: the
    // request reached here with the mount taken off, and a page reading `route.url()` on both sides
    // would otherwise render one address and hydrate against another.
    const at = new URL(request.url)
    at.pathname = mounted(at.pathname)
    arrive(at.href, page.pattern, params)
    // 11.32 — the page renders in a scope of its own, so what its values hold is this request's —
    // and 41.13, every call it makes is left for the browser's own call to be answered from.
    beginRender({ seed: seedFor(caller), calls: [] })
    // 41.1, 35.2 — THE DOCUMENT IS THE BUILT PAGE, read whole before there is a `Response` to commit a
    // status to: a refusal the page read, or a throw, is answered by the nearest error page at its own
    // status rather than as a 200 the stream then abandons.
    let document: Uint8Array<ArrayBuffer>
    try {
        document = await renderDocument(bound, page.document)
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
    return compressAnswer(document, request, headers, writtenStatus())
}

// 25.3 — `health` IS A `GET` LIKE ANY OTHER, as the principal's document is: a render's call is left
// in the seed buffer and started from the head, and the browser's own call takes that answer.

// 25.1, 26.17 — THE HANDLERS ABIDE MOUNTS ITSELF, answered as the app's are.
const OWN_HANDLERS = new Map([
    PRINCIPAL_MOUNT,
    mountedOwn(HEALTH_ADDRESS, 'health', health),
])

// THE ADDRESSES ABIDE ANSWERS ITSELF, looked up once rather than asked in turn: each to its value,
// a `Response` of its own, or `undefined` for a 404.
const SURFACES = new Map<
    string,
    (app: AppSources, request: Request) => unknown
>([
    [OPENAPI_ADDRESS, (app) => openApi(app.handlers)],
    // Filled by the app answering this request, so never `undefined` here.
    [
        MCP_ADDRESS,
        (_app, request) =>
            answerMcp((within('mcp').app as AnsweringApp).mcp, request),
    ],
    [BRIDGE_ADDRESS, (_app, request) => answerBridge(request)],
])

// What a call made in a page's render reports into: the seed buffer (41.13), and — where the handler
// is mounted — the request the browser will make for it, for the early-call script (41.20). Once per
// render, as the browser's `Rpc` makes it once, and the seed buffer is what says which is the once.
export function reachedInRender(
    rpc: object,
    args: unknown,
    reached: unknown,
): void {
    const page = currentRequestScope()?.page
    if (page === undefined || !page.seed(rpc, args, reached)) return
    // 16.10 — the address the browser's own call is made at, stamped under the mount by
    // `mountHandlers` — and `undefined` on a handler nothing mounted.
    const { address, method } = rpc as Rpc<unknown, unknown>
    if (address === undefined) return
    page.calls.push({
        request: rpcRequest(
            method,
            address,
            args as Record<string, unknown> | undefined,
        ),
        reached,
    })
}

/**
 * The server's table the compiler writes (`SERVER_TABLE`): the routes and the error pages.
 *
 * Served out of the compilation (`abideModules`) — the one a build kept, or `abide dev`'s.
 */
export type ServerTable = { routes: ServerRoute[]; errors: ServerError[] }

/**
 * What a command hands `appSources`: the parts it read, built or compiled, and the client lane.
 *
 * ONE SHAPE FOR EVERY SUPPLIER — `abide start` off disk, a compiled app out of itself, `abide dev` out
 * of memory, and a test handing over modules it already holds — so what differs between them is
 * where a part came from and never how the app is assembled from it.
 */
export type SourceParts = {
    table: ServerTable
    /** The handler table the build wrote, each row with its module's loader. 16.2. */
    handlers: MountRow[]
    /** Every public file, by its name below the directory to its path. 38.18, 38.19. */
    published: Map<string, string>
    /**
     * The bundle's manifest, its lane, and `head` — `abide dev`'s reload client (38.17), after the
     * app's own tags.
     *
     * A PROMISE WHERE THE BUNDLE IS STILL BUILDING: `abide dev`'s handlers mount and its public files
     * hash while the bundler runs, rather than after it — ~40 ms of a docs-app reload.
     */
    client: ClientLane | Promise<ClientLane>
    explained: AppSources['explained']
}

type ClientLane = {
    manifest: Manifest
    framework: AppSources['framework']
    head: string
}

/**
 * The sources an `App` is booted over, off the parts a command supplies.
 *
 * 30.9 — MOST SPECIFIC FIRST, ranked off the table rather than in it. The ordering IS the client
 * router's own: both seams compile through `rankRoutes` and walk a route with `matchOf` — the
 * server past a route that has no answer for the method asked, which the router never is — so
 * "the two cannot resolve one address differently" is a grep rather than a promise. 35.2 — the
 * error pages deepest directory first, so the nearest answers.
 */
export async function appSources(parts: SourceParts): Promise<AppSources> {
    const [mounted, published, client] = await Promise.all([
        mountHandlers(parts.handlers),
        publicFilesAt(parts.published),
        parts.client,
    ])
    // 35.6 — every page is served in abide's own document; what it carries beyond that, the root
    // `layout.abide` writes (35.15).
    const documentOf = (modules: string[]): string =>
        intoHead(
            DEFAULT_DOCUMENT,
            clientTags(client.manifest, modules) + client.head,
        )
    const pages: Omit<Ranked, 'segments'>[] = []
    for (const route of parts.table.routes)
        pages.push({
            pattern: route.pattern,
            load: route.load,
            layouts: route.layouts,
            document: documentOf(route.clientModules),
        })
    // 19.1 — the build refused two files at one route and method, so a route is one row however
    // many methods answer at it.
    const rows = new Map<string, Omit<RouteRow, 'segments'>>()
    const rowAt = (pattern: string): Omit<RouteRow, 'segments'> => {
        let row = rows.get(pattern)
        if (row === undefined) {
            row = {
                pattern,
                page: undefined,
                handlers: new Map(),
                answers: new Map(),
            }
            rows.set(pattern, row)
        }
        return row
    }
    for (const page of rankRoutes(pages)) rowAt(page.pattern).page = page
    for (const handler of mounted.handlers.values())
        rowAt(handler.address).handlers.set(handler.method, handler)
    const errors: RankedError[] = []
    for (const error of parts.table.errors)
        errors.push({ ...error, segments: parseRoutePattern(error.pattern) })
    errors.sort((a, b) => b.segments.length - a.segments.length)
    const sources: AppSources = {
        routes: rankRoutes([...rows.values()]),
        errors,
        errorDocument: documentOf([]),
        framework: client.framework,
        published,
        explained: parts.explained,
        ...mounted,
    }
    for (const row of sources.routes) {
        if (row.page !== undefined)
            row.answers.set(
                row.page,
                answerInside(sources, row.page, rungsOver(row.pattern)),
            )
        for (const handler of row.handlers.values())
            row.answers.set(
                handler,
                answerInside(sources, handler, handler.rungs),
            )
    }
    return sources
}

/** `found`'s answer inside the rungs filed over its route. 16.14, 37.2. */
function answerInside(
    app: AppSources,
    found: Ranked | Mounted,
    rungs: AppRung[],
): (ctx: { request: Request }) => Promise<Response> {
    return compose(rungs, ({ request }) => answerMatched(app, request, found))
}

/**
 * The head tags that load the app: its metas, stylesheet, entry script and the route's preloads.
 *
 * 38.22, and 38.23 for the stylesheet beside it. An app does not write either: the bundle's
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
 * 38.28 — THE ROUTE'S CHUNKS ARE PRELOADED BESIDE THE ENTRY. Left to the client, the page's chunk
 * and the shared runtime it imports are only asked for once the entry has arrived and run the
 * router — a whole round trip after the document, for the largest file in the bundle. Named here,
 * they are requested while the document is still being parsed.
 *
 * EVERY NAME IS THE MANIFEST'S, the entry's included: a build hashes it (38.5). A manifest with no
 * entry is a bundle that failed under `abide dev` (38.17), and gets no tags rather than a
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
    // 28.4 — the app's name, so a browser's `log.named` prefixes the one the server's does.
    tags += `<meta name="${APP_META}" content="${escapeAttribute(appName())}">`
    // 16.10 — the mount the browser resolves every address against, the root's `''` included: a
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
 * The public files by address, off each file's name and where its bytes are.
 *
 * 38.18 and 38.19's directory, as an address per file — or a compiled app's, whose bytes are
 * inside itself. Read at boot rather than per request, and the ETAG IS READ WITH IT: 21.13
 * derives it from the bytes, so there is no cheaper moment than the one read that is happening
 * anyway. The bytes are hashed and dropped — `Bun.file` streams the body when somebody asks, so a
 * large file is not held in memory for the life of the process.
 */
async function publicFilesAt(
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

function notFound(): Response {
    return plainAnswer('not found', 404)
}

/** Whether the request only reads: a `GET` or a `HEAD`. 15.17. */
function readsOnly(request: Request): boolean {
    return request.method === 'GET' || request.method === 'HEAD'
}

const READS = ['GET', 'HEAD']

/**
 * 15.17 — a 405, naming what is answered at `pathname`.
 *
 * `request` where a route's methods were asked, which 15.22 answers in the asker's lane; a public
 * file and the bundle are a document's alone.
 */
async function methodRefused(
    app: AppSources,
    pathname: string,
    allowed: string[],
    request?: Request,
): Promise<Response> {
    const failure = refuse(405)
    const answer =
        request === undefined
            ? await answerFailure(app, pathname, failure)
            : await laneFailure(app, pathname, failure, request)
    answer.headers.set('allow', allowed.join(', '))
    return answer
}

/**
 * A failure at an address whose lane only the request can say: a page's, painted, where it prefers
 * a document, and a handler's otherwise. 15.22.
 */
function laneFailure(
    app: AppSources,
    pathname: string,
    failure: Failed<string, unknown>,
    request: Request,
): Response | Promise<Response> {
    return prefers(request, 'text/html', 'application/json')
        ? answerFailure(app, pathname, failure)
        : answered(failure)
}

/**
 * A public file's answer, conditional and range-aware off the etag read at boot.
 *
 * 21.14 and 16.35's range, answered before a byte is read. 36.12 and 36.14 — the bytes as
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
