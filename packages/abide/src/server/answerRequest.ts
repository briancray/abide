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
    HEALTH_ADDRESS,
    MCP_ADDRESS,
    OPENAPI_ADDRESS,
    PRIVATE_HANDLERS_ADDRESS,
} from '#shared/ADDRESSES.ts'
import { decodedOrKept } from '#shared/decodedOrKept.ts'
import { isFailed } from '#shared/Failed.ts'
import { health } from '#shared/health.ts'
import { matchOf, type Params, partsOf } from '#shared/matchRoute.ts'
import { compose } from '#shared/Middleware.ts'
import { mounted } from '#shared/mount.ts'
import { NAVIGATION_HEADER } from '#shared/NAVIGATION_HEADER.ts'
import { notFound as refusedNotFound, refuse } from '#shared/refuse.ts'
import { arrive } from '#shared/route.ts'
import type { Segment } from '#shared/routePattern.ts'
import type { Method } from '#shared/rpc.ts'

import { answerFailure, laneFailure } from './answerFailure.ts'
import { answerRpc } from './answerRpc.ts'
import { answerBlobTagged, answerValue } from './answerValue.ts'
import { answerBridge } from './bridgeRelay.ts'
import { compressAnswer } from './compressAnswer.ts'
import { DOCUMENT_HEADERS } from './DOCUMENT_HEADERS.ts'
import { answerMcp, openApi } from './generatedSurfaces.ts'
import {
    type AppContext,
    failureOf,
    type Lane,
    type LaneRung,
} from './hooks.ts'
import { type Mounted, mountedOwn } from './mountHandlers.ts'
import { muxAdmission } from './muxUpgrade.ts'
import { OFFLINE_STALE } from './OFFLINE_STALE.ts'
import { beginPageRender } from './PageRender.ts'
import { plainAnswer } from './plainAnswer.ts'
import { PRINCIPAL_MOUNT } from './principal.ts'
import { boundPage, type Component, renderDocument } from './render.ts'
import {
    adoptRequest,
    type AnsweringApp,
    currentRequestScope,
    type RequestScope,
    within,
    writtenStatus,
} from './requestScope.ts'

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
    // 23.26 — each matcher its pattern names, to the anchored source the build resolved it to.
    matchers: Record<string, string>
}

// 35.2 — an error page, and the directory it answers for.
type ServerError = Omit<ServerRoute, 'clientModules'>

export type RankedError = ServerError & { segments: Segment[] }

export type Ranked = RankedError & {
    // The document this route is painted into, with the tags that load the app already in its
    // head (38.22, 38.23) and the preloads for this route's own modules (38.28). One per route and
    // built at boot, so a request pays for none of it.
    document: string
}

/**
 * One route of the app: the page at it, and the handler answering each method there.
 *
 * 19.1 — one file per method per route, so a route is a row and a method is a column, and 19.20's
 * "the most specific route answering the method" is a walk down the rows asking each column.
 */
export type RouteRow = {
    pattern: string
    matchers: Record<string, string>
    segments: Segment[]
    page: Ranked | undefined
    handlers: Map<Method, Mounted>
    /**
     * The page and each handler, keyed by itself, inside the rungs its file's route filed (37.2).
     *
     * 16.14 — composed once with the table. Every server block is imported before it is built
     * (37.1), so these are the rungs the boot found, as the root's are.
     */
    answers: Map<Ranked | Mounted, (ctx: AppContext) => Promise<Response>>
}

/** A public file, read once at boot: where the bytes are, the etag off them, and its type. */
export type PublicFile = { path: string; etag: string; type: string }

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
    /** 21.22, 21.23 — whether a page registers the worker `ABIDE_OFFLINE` turns on (45.1). */
    offline: boolean
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

// 35.19 — what fetch calls a navigation request's destinations, and a script's `fetch`.
const PAGE_DESTINATIONS = new Set([
    'document',
    'embed',
    'frame',
    'iframe',
    'object',
    'empty',
])

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
    // answered as the app's are — 21.4, save that neither is the app's to keep on the device.
    const own = OWN_HANDLERS.get(asked)
    if (own !== undefined)
        return own.method === method
            ? answerRpc(own, {}, url, request, app, false)
            : methodRefused(app, asked, [own.method])
    // 20.5, 20.9, 36.7 — a surface of abide's own, or a 404 where it answers nothing.
    const surface = SURFACES.get(asked)
    if (surface !== undefined) {
        const answer = await surface.answer(app, request)
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
    if (isFrameworkAddress(asked)) {
        const answer = app.framework(asked, request)
        if (answer === undefined) return notFound()
        return readsOnly(request) ? answer : methodRefused(app, asked, READS)
    }

    // 36.11 — A PUBLIC FILE IS ITS PATH BELOW THE DIRECTORY, so `/favicon.ico` is answered
    // before any route is tried. The order is not load-bearing: the compile `abide build` and
    // `abide dev` share refuses a collision (36.13) over the same two trees before anything is served,
    // so at run time there can never be a collision to resolve. 36.11 — keyed by its name on disk
    // and asked for percent-encoded: `my photo.jpg` is `/my%20photo.jpg`.
    const file = app.published.get(decodedOrKept(asked))
    if (file !== undefined)
        return readsOnly(request)
            ? publicResponse(request, file, app.offline)
            : methodRefused(app, asked, READS)

    // 15.16 — an address that will not percent-decode names nothing, and is the caller's fault.
    const parts = partsOf(asked)
    if (parts === undefined)
        return answerFailure(
            app,
            asked,
            refuse(400, 'The address is not a valid path.'),
        )

    const { found, allowed } = routed(app, parts, request)
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
        found.handler === undefined ? found.route.pattern : found.handler.scope
    scope.params = found.params
    const answer = found.route.answers.get(
        found.handler ?? (found.route.page as Ranked),
    ) as (ctx: AppContext) => Promise<Response>
    return answer({
        request,
        lane: found.handler === undefined ? 'page' : 'handler',
    })
}

/**
 * What `answerRequest` would answer `request` with, by the arm of its dispatch it takes. 37.19.
 *
 * ASKED IN THE DISPATCH'S OWN ORDER, over the same tables, so a gate reading it before routing
 * (37.3) is told what routing will choose.
 */
export function laneOf(app: AppSources, request: Request): Lane {
    const asked = new URL(request.url).pathname
    if (OWN_HANDLERS.has(asked)) return 'handler'
    const surface = SURFACES.get(asked)
    if (surface !== undefined) return surface.lane
    if (muxAdmission(asked, request, app) !== undefined) return 'socket'
    if (isFrameworkAddress(asked)) return 'abide'
    if (app.published.has(decodedOrKept(asked))) return 'file'
    const parts = partsOf(asked)
    if (parts === undefined) return 'page'
    return routed(app, parts, request).found?.handler === undefined
        ? 'page'
        : 'handler'
}

/**
 * Whether `asked` is an address abide answers out of the command's own files.
 *
 * 16.70 — a private handler is answered by the route table, below abide's own namespace.
 */
function isFrameworkAddress(asked: string): boolean {
    return (
        asked.startsWith(`${ABIDE_ADDRESS}/`) &&
        !asked.startsWith(`${PRIVATE_HANDLERS_ADDRESS}/`)
    )
}

/**
 * The route answering `request` at `parts`, or the methods answered there where none answers its own.
 *
 * 19.20 — THE MOST SPECIFIC ROUTE ANSWERING THE METHOD, an `OPTIONS` asking about the method
 * its preflight names (16.24). A route that matches and answers some other method is held, so
 * an address nothing answers the method at is a 405 naming what is answered there (15.17).
 */
function routed(
    app: AppSources,
    parts: string[],
    request: Request,
): {
    found:
        | { route: RouteRow; params: Params; handler: Mounted | undefined }
        | undefined
    allowed: Set<string> | undefined
} {
    const preflight = request.method === 'OPTIONS'
    // `null` for an `OPTIONS` that names no method, which is no preflight (Fetch's CORS-preflight
    // request carries one) and so no handler's: the route answers 15.17's 405 with what it allows.
    const asking = preflight
        ? request.headers.get('access-control-request-method')
        : request.method === 'HEAD'
          ? 'GET'
          : request.method
    let allowed: Set<string> | undefined
    for (const route of app.routes) {
        const params = matchOf(route.segments, parts)
        if (params === undefined) continue
        const handler =
            asking === null ? undefined : route.handlers.get(asking as Method)
        if (
            handler !== undefined ||
            (!preflight && asking === 'GET' && route.page !== undefined)
        )
            return { found: { route, params, handler }, allowed: undefined }
        allowed ??= new Set()
        if (route.page !== undefined) allowed.add('GET').add('HEAD')
        for (const method of route.handlers.keys()) {
            allowed.add(method)
            if (method === 'GET') allowed.add('HEAD')
        }
    }
    return { found: undefined, allowed }
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
    if ('handler' in found)
        return answerRpc(found, params, url, request, app, app.offline)
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

    // 35.19 — A REQUEST THAT CANNOT DISPLAY A PAGE, such as the `/favicon.ico` a browser asks every
    // site for where a `[param]` page matches it: refused before setup, so no handler runs for it
    // and no caller is minted. Bare, because an error page would set up too and nothing shows it;
    // `no-store`, because the address answers a navigation with the page.
    const destination = request.headers.get('sec-fetch-dest')
    if (destination !== null && !PAGE_DESTINATIONS.has(destination))
        return new Response(null, {
            status: 404,
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
    if (app.offline) headers.set('cache-control', `private, ${OFFLINE_STALE}`)
    // THE HEADERS A `GET` WOULD CARRY, and no render for a body nobody is sent — nor a caller
    // minted for a request that never becomes a page.
    if (request.method === 'HEAD')
        return new Response(null, { status: writtenStatus(), headers })
    // 23.1 — WHERE THIS PAGE IS, for its setup to read, in the request's own instances (11.32).
    // 16.10 — AT THE ADDRESS IT IS SERVED AT, which is the one the browser's router arrives at: the
    // request reached here with the mount taken off, and a page reading `route.url()` on both sides
    // would otherwise render one address and hydrate against another.
    const at = new URL(request.url)
    at.pathname = mounted(at.pathname)
    // 23.29 — a request is a document load, which arrives at an entry of its own.
    arrive(at.href, page.pattern, params, 0)
    // 11.32 — the page renders in a scope of its own, so what its values hold is this request's —
    // and 41.13, every call it makes is recorded into its render.
    beginPageRender(request)
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
// 37.19 — each with the lane a gate is told it is.
const SURFACES = new Map<
    string,
    {
        lane: Lane
        answer: (app: AppSources, request: Request) => unknown
    }
>([
    [
        OPENAPI_ADDRESS,
        { lane: 'openapi', answer: (app) => openApi(app.handlers) },
    ],
    // Filled by the app answering this request, so never `undefined` here.
    [
        MCP_ADDRESS,
        {
            lane: 'mcp',
            answer: (_app, request) =>
                answerMcp((within('mcp').app as AnsweringApp).mcp, request),
        },
    ],
    [
        BRIDGE_ADDRESS,
        { lane: 'bridge', answer: (_app, request) => answerBridge(request) },
    ],
])

/**
 * The server's table the compiler writes (`SERVER_TABLE`): the routes and the error pages.
 *
 * Served out of the compilation (`abideModules`) — the one a build kept, or `abide dev`'s.
 */
export type ServerTable = { routes: ServerRoute[]; errors: ServerError[] }

/** `found`'s answer inside the rungs filed over its route. 16.14, 37.2. */
export function answerInside(
    app: AppSources,
    found: Ranked | Mounted,
    rungs: LaneRung[],
): (ctx: AppContext) => Promise<Response> {
    return compose(rungs, ({ request }) => answerMatched(app, request, found))
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
 * A public file's answer, conditional and range-aware off the etag read at boot.
 *
 * 21.14 and 16.35's range, answered before a byte is read. 36.12 and 36.14 — the bytes as
 * authored, and the content-type off the extension, which is what `Bun.file` already derives
 * rather than a table kept here.
 */
function publicResponse(
    request: Request,
    file: PublicFile,
    offline: boolean,
): Response {
    return answerBlobTagged(
        Bun.file(file.path, { type: file.type }),
        file.etag,
        request,
        // 21.12. Revalidated every time and cached in between, which is what an unhashed name
        // earns — the etag is what makes that one conditional request rather than one transfer.
        // 21.23 — and served stale where the device keeps it, while that request is made.
        new Headers({
            'cache-control': offline
                ? `public, max-age=0, ${OFFLINE_STALE}`
                : 'public, max-age=0, must-revalidate',
        }),
        200,
    )
}
