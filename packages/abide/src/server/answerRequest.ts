// HOW AN APP ANSWERS, given what it has. Two commands supply the parts — `abide start` off what
// the build wrote (38.6) and `abide dev` out of memory (38.17) — and the request path itself is
// this one, because a dev server that resolves an address differently from the served one is a
// bug a reader meets in production and never in development.
//
// WHAT IS NOT HERE is worth stating, since the rulebook describes a much larger path. There is no
// `App` (42), no middleware onion (16.15) and no lifecycle hook (37). The request scope they wait
// on is `requestScope.ts`, and a page and a handler each answer inside one.

import { firstMatch } from '#shared/matchRoute.ts'
import type { Seed } from '#shared/reactive/scoping.ts'
import {
    parseRoutePattern,
    rankBySpecificity,
    type Segment,
} from '#shared/routePattern.ts'
import { rpcRequest } from '#shared/rpcRequest.ts'
import { addressOf, answerRpc, type Mounted } from './answerRpc.ts'
import {
    ABIDE_ADDRESS,
    CLIENT_ADDRESS,
    CLIENT_ENTRY,
    RPC_ADDRESS,
} from './CLIENT_BUILD.ts'
import { callerOf, mintCaller } from './callerOf.ts'
import { chunksOf, type Manifest } from './chunksByModule.ts'
import { compressStream } from './compressStream.ts'
import { namesUnder } from './namesUnder.ts'
import { ENCODINGS, negotiateEncoding } from './negotiateEncoding.ts'
import { type Component, composePage, headAnchor, render } from './render.ts'
import { earlyCalls, inScopeEachPull } from './requestScope.ts'
import { seedFor } from './seedBuffer.ts'

// One row of the table the compiler writes to `<out>/server.ts`. The loader is a dynamic import
// so a page's markup is off the boot path until an address asks for it, which is the same reason
// the client table's loaders are (30.11).
export type ServerRoute = {
    pattern: string
    load: () => Promise<{ default: Component }>
    // 35.1 — the layouts this page renders inside, outermost first, as the compiler found them.
    layouts: (() => Promise<{ default: Component }>)[]
    // 38.29 — the modules a browser loads at this address, the page's then its layouts', as keys
    // into the manifest `chunksByModule` reads.
    clientModules: string[]
}

export type Ranked = {
    pattern: string
    segments: Segment[]
    load: ServerRoute['load']
    layouts: ServerRoute['layouts']
    // The document this route is painted into, with the tags that load the app already in its
    // head (38.23, 38.24) and the preloads for this route's own modules (38.29). One per route and
    // built at boot, so a request pays for none of it.
    document: string
}

// A public file, read once at boot: where the bytes are, and the etag off them.
export type PublicFile = { path: string; etag: string }

export type AppSources = {
    // 30.9's order, which `rankRoutes` is the only way to get.
    routes: Ranked[]
    // Everything under `/__abide` — the bundle both commands answer there (38.21), and the
    // reload client `abide dev` adds beside it (38.18). One lane rather than an asset table plus
    // an exception, so what a command answers there is a fact about the command.
    framework: (pathname: string, request: Request) => Response | undefined
    // 38.19 and 38.20 — a file's address below `public`, to the file itself. From the built
    // output for `abide start` and from the source tree for `abide dev`.
    published: Map<string, PublicFile>
    // 16.2 — every handler's address, to what answers it (`mountHandlers`).
    handlers: Map<string, Mounted>
}

export async function answerRequest(
    app: AppSources,
    request: Request,
): Promise<Response> {
    const url = new URL(request.url)
    const asked = url.pathname

    if (asked.startsWith(`${RPC_ADDRESS}/`))
        return answerRpc(app.handlers, url, request)
    if (asked.startsWith(`${ABIDE_ADDRESS}/`))
        return app.framework(asked, request) ?? notFound()

    // 36.11 — A PUBLIC FILE IS ITS PATH BELOW THE DIRECTORY, so `/favicon.ico` is answered
    // before any route is tried. The order is not load-bearing: every command that serves
    // runs `refuseAddressCollision` (36.13) over the same two trees before it answers
    // anything, so at run time there can never be a collision to resolve.
    const file = app.published.get(asked)
    if (file !== undefined) return publicResponse(request, file)

    const found = firstMatch(app.routes, asked)
    // 38.22. The client router leaves an unmatched address to the document (30.10), so this
    // is where that address arrives and there is nothing behind it.
    if (found === undefined) return notFound()

    // 41.1 — THE IMPORTS ARE THE COMPONENT'S, so they run after `render` has flushed the head
    // rather than ahead of the whole response. The first request for a page after boot pays the
    // import, and every fetch the head starts is under way while it does.
    //
    // THE PAGE AND ITS CHAIN, IN ONE ROUND OF WAITING. A nested `Promise.all` rather than one
    // flat array with the page spliced onto the head: the two settle together either way, and the
    // flat form's element type is the union of the two, so reading a head and a tail back off it
    // took an `as` per read. This is the same concurrency with the types carrying it.
    //
    // STARTED WHEN `render` ASKS, not here. Started here, a reader who hung up before the stream
    // was pulled left a rejection nothing would ever await.
    const bound = async (): Promise<unknown> => {
        const [loadedPage, loadedLayouts] = await Promise.all([
            found.route.load(),
            Promise.all(found.route.layouts.map((layout) => layout())),
        ])
        const layouts: Component[] = []
        for (const module of loadedLayouts) layouts.push(module.default)
        // 35.3 — BOUND HERE, because `render` takes a component that already has its props.
        // 33.4 — a prop is an ACCESSOR, which is the contract `renderComponent` renders a child
        // under and the one the client router mounts a page under; the params are the record
        // `matchRoute` hands the client for this same address.
        return composePage(layouts, loadedPage.default, {
            params: () => found.params,
        })
    }
    // 38.30 — `vary` WHETHER OR NOT THIS ONE IS COMPRESSED: the document is negotiated, and a cache
    // that stored the identity answer for a reader who sent no `accept-encoding` must not hand it
    // to one who did, nor the reverse.
    // 11.32 — the page renders in a scope of its own, so what its values hold is this request's —
    // and 41.13, every call it makes is left for the browser's own call to be answered from.
    const headers: Record<string, string> = { ...DOCUMENT_HEADERS }
    let caller = callerOf(request)
    if (caller === undefined) {
        const minted = mintCaller()
        caller = minted.caller
        headers['set-cookie'] = minted.cookie
    }
    const chunks = inScopeEachPull(request, reportFor(caller), () =>
        render(bound, found.route.document),
    )
    const encoding = negotiateEncoding(
        request.headers.get('accept-encoding'),
        ENCODINGS,
    )
    if (encoding === undefined)
        return new Response(streamOf(chunks), { headers })
    headers['content-encoding'] = encoding
    return new Response(compressStream(chunks, encoding), { headers })
}

// What a page's render reports each call into: the seed buffer (41.13), and — where the handler is
// mounted — the request the browser will make for it, for the early-call script (41.21). Once per
// request, as the browser's `Rpc` makes it once, and the seed buffer is what says which is the once.
function reportFor(caller: string): Seed {
    const seed = seedFor(caller)
    return (rpc, args, reached) => {
        if (!seed(rpc, args, reached)) return
        const mount = addressOf(rpc)
        const calls = earlyCalls()
        if (mount === undefined || calls === undefined) return
        calls.push(
            rpcRequest(
                mount.method,
                mount.address,
                args as Record<string, unknown> | undefined,
            ),
        )
    }
}

const DOCUMENT_HEADERS = {
    'content-type': 'text/html; charset=utf-8',
    vary: 'accept-encoding',
}

// 30.9 — MOST SPECIFIC FIRST, ranked off the table rather than in it. The ordering IS the client
// router's own: both seams sort through `rankBySpecificity` and resolve through `firstMatch`, so
// "the two cannot resolve one address differently" is a grep rather than a promise.
export function rankRoutes(
    table: ServerRoute[],
    documentOf: (route: ServerRoute) => string,
): Ranked[] {
    const routes: Ranked[] = []
    for (const route of table)
        routes.push({
            pattern: route.pattern,
            segments: parseRoutePattern(route.pattern),
            load: route.load,
            layouts: route.layouts,
            document: documentOf(route),
        })
    return rankBySpecificity(routes)
}

// THE TAGS THAT LOAD THE APP — 38.23, and 38.24 for the stylesheet beside it. An app does not
// write either: the bundle's address is the build's, and a hand-written one is a path that goes
// stale the first time the output layout moves.
//
// THE STYLESHEET GOES FIRST, and ahead of the page's own head contributions for the same reason:
// a document that parses its script before its styles paints once unstyled. It is a plain `<link>`
// rather than anything the client does, so a page the server painted is styled with no JS at all.
//
// ONE STYLESHEET FOR THE APP, which is NOT 34.5's per-component dependency: the bundler collects
// every stylesheet reachable from the entry into one file, so a page that imports none is served
// this too. 34.3's scope token is what makes that distinction matter and it is not built.
//
// 38.29 — THE ROUTE'S CHUNKS ARE PRELOADED BESIDE THE ENTRY. Left to the client, the page's chunk
// and the shared runtime it imports are only asked for once the entry has arrived and run the
// router — a whole round trip after the document, for the largest file in the bundle. Named here,
// they are requested while the document is still being parsed.
//
// EVERY NAME IS THE MANIFEST'S, the entry's included: a build hashes it (38.5). A manifest with no
// entry is a bundle that failed under `abide dev` (38.18), and gets no tags rather than a
// `<script>` at a 404.
export function clientTags(manifest: Manifest, modules: string[]): string {
    if (manifest.entry === undefined) return ''
    let tags =
        manifest.stylesheet === undefined
            ? ''
            : `<link rel="stylesheet" href="${CLIENT_ADDRESS}/${manifest.stylesheet}">`
    tags += `<script type="module" src="${CLIENT_ADDRESS}/${manifest.entry}"></script>`
    for (const chunk of chunksOf([`${CLIENT_ENTRY}.ts`, ...modules], manifest))
        tags += `<link rel="modulepreload" href="${CLIENT_ADDRESS}/${chunk}">`
    return tags
}

// The tags, at the head anchor `render` uses — so a shell with no `</head>` puts them where its
// head content goes rather than inside the body.
export function intoHead(shell: string, tags: string): string {
    const at = headAnchor(shell)
    return shell.slice(0, at) + tags + shell.slice(at)
}

// 38.19 and 38.20's directory, as an address per file. Read at boot rather than per request, and
// the ETAG IS READ WITH IT: 21.13 derives it from the bytes, so there is no cheaper moment than
// the one read that is happening anyway. The bytes are hashed and dropped — `Bun.file` streams
// the body when somebody asks, so a large file is not held in memory for the life of the process.
//
// `names` is the listing, for a caller that already has one.
export async function publicFilesUnder(
    root: string,
    names: string[] = namesUnder(root),
): Promise<Map<string, PublicFile>> {
    const files = new Map<string, PublicFile>()
    // THE READS OVERLAP. They are independent, and `abide dev` runs this again on every
    // reload rather than once at boot — so it is reload latency an author waits on, not just
    // a boot cost. The hashing below is unchanged; only the reads are asked for at once.
    const read = await Promise.all(
        names.map((name) => Bun.file(`${root}/${name}`).bytes()),
    )
    for (let index = 0; index < names.length; index += 1) {
        const name = names[index] as string
        // Non-cryptographic, and that is the right tool: an etag answers "are these the same
        // bytes", not "could somebody forge these bytes".
        files.set(`/${name}`, {
            path: `${root}/${name}`,
            etag: `"${Bun.hash(read[index] as Uint8Array).toString(16)}"`,
        })
    }
    return files
}

export function notFound(): Response {
    return new Response('not found', { status: 404 })
}

// 35.5's generator, as a body, pulled a chunk at a time rather than collected — the shape 41.1's
// early head needs. A reader who hangs up returns the generator, which stops the render in its scope
// (`inScopeEachPull`), as `compressStream` does on its path.
function streamOf(
    chunks: AsyncGenerator<Uint8Array>,
): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            const next = await chunks.next()
            if (next.done === true) controller.close()
            else controller.enqueue(next.value)
        },
        cancel() {
            void chunks.return(undefined)
        },
    })
}

function publicResponse(request: Request, file: PublicFile): Response {
    // 21.14 — the conditional request, answered before a byte is read.
    if (request.headers.get('if-none-match') === file.etag)
        return new Response(null, {
            status: 304,
            headers: { etag: file.etag, ...PUBLIC_HEADERS },
        })
    // 36.12 and 36.14 — the bytes as authored, and the content-type off the extension, which is
    // what `Bun.file` already derives rather than a table kept here.
    return new Response(Bun.file(file.path), {
        headers: { etag: file.etag, ...PUBLIC_HEADERS },
    })
}

// 21.12. Revalidated every time and cached in between, which is what an unhashed name earns — the
// etag is what makes that one conditional request rather than one transfer.
const PUBLIC_HEADERS = { 'cache-control': 'public, max-age=0, must-revalidate' }
