// HOW AN APP ANSWERS, given what it has. Two commands supply the parts — `abide start` off what
// the build wrote (38.6) and `abide dev` out of memory (38.17) — and the request path itself is
// this one, because a dev server that resolves an address differently from the served one is a
// bug a reader meets in production and never in development.
//
// WHAT IS NOT HERE is worth stating, since the rulebook describes a much larger path. There is no
// `App` (42), no middleware onion (16.15), no rpc over the wire (16.29) and no lifecycle hook
// (37): those want a request scope, and a request scope is the next thing rather than a gap in
// this one.

import { matchRoute, type Params } from '#shared/matchRoute.ts'
import {
    compareRoutes,
    parseRoutePattern,
    type Segment,
} from '#shared/routePattern.ts'
import { ABIDE_ADDRESS, CLIENT_ADDRESS, CLIENT_ENTRY } from './CLIENT_BUILD.ts'
import { type Component, composePage, headAnchor, render } from './render.ts'

// One row of the table the compiler writes to `<out>/server.ts`. The loader is a dynamic import
// so a page's markup is off the boot path until an address asks for it, which is the same reason
// the client table's loaders are (30.11).
export type ServerRoute = {
    pattern: string
    load: () => Promise<{ default: Component }>
    // 35.1 — the layouts this page renders inside, outermost first, as the compiler found them.
    layouts: (() => Promise<{ default: Component }>)[]
}

export type Ranked = {
    pattern: string
    segments: Segment[]
    load: ServerRoute['load']
    layouts: ServerRoute['layouts']
}

// A public file, read once at boot: where the bytes are, and the etag off them.
export type PublicFile = { path: string; etag: string }

export type AppSources = {
    // 30.9's order, which `rankRoutes` is the only way to get.
    routes: Ranked[]
    // The document, with the tags that load the app already in its head (38.23, 38.24).
    shell: string
    // Everything under `/__abide` — the bundle both commands answer there (38.21), and the
    // reload client `abide dev` adds beside it (38.18). One lane rather than an asset table plus
    // an exception, so what a command answers there is a fact about the command.
    framework: (pathname: string) => Response | undefined
    // 38.19 and 38.20 — a file's address below `public`, to the file itself. From the built
    // output for `abide start` and from the source tree for `abide dev`.
    published: Map<string, PublicFile>
}

export async function answerRequest(
    app: AppSources,
    request: Request,
): Promise<Response> {
    const asked = new URL(request.url).pathname

    if (asked.startsWith(`${ABIDE_ADDRESS}/`))
        return app.framework(asked) ?? notFound()

    // 36.11 — A PUBLIC FILE IS ITS PATH BELOW THE DIRECTORY, so `/favicon.ico` is answered
    // before any route is tried. The order is not load-bearing: 36.13 makes a collision
    // between the two a build error, so at run time there can never be one to resolve.
    const file = app.published.get(asked)
    if (file !== undefined) return publicResponse(request, file)

    const found = match(app.routes, asked)
    // 38.22. The client router leaves an unmatched address to the document (30.10), so this
    // is where that address arrives and there is nothing behind it.
    if (found === undefined) return notFound()

    const loaded = await Promise.all([
        found.route.load(),
        ...found.route.layouts.map((layout) => layout()),
    ])
    const [page, ...layouts] = loaded.map((module) => module.default)
    // 35.3 — BOUND HERE, because `render` takes a component that already has its props.
    // 33.4 — a prop is an ACCESSOR, which is the contract `renderComponent` renders a child
    // under and the one the client router mounts a page under; the params are the record
    // `matchRoute` hands the client for this same address.
    const bound = (): unknown =>
        composePage(layouts as Component[], page as Component, {
            params: () => found.params,
        })
    return new Response(streamOf(render(bound, app.shell)), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
    })
}

// 30.9 — MOST SPECIFIC FIRST, ranked off the table rather than in it, so the ordering is the
// client router's own and the two cannot resolve one address differently.
export function rankRoutes(table: ServerRoute[]): Ranked[] {
    const routes: Ranked[] = []
    for (const route of table)
        routes.push({
            pattern: route.pattern,
            segments: parseRoutePattern(route.pattern),
            load: route.load,
            // A table written before layouts existed has no chain, and a page with none is the
            // common case either way.
            layouts: route.layouts ?? [],
        })
    routes.sort((a, b) => compareRoutes(a.segments, b.segments))
    return routes
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
export function clientTags(styled: boolean): string {
    const link = styled
        ? `<link rel="stylesheet" href="${CLIENT_ADDRESS}/${CLIENT_ENTRY}.css">`
        : ''
    return `${link}<script type="module" src="${CLIENT_ADDRESS}/${CLIENT_ENTRY}.js"></script>`
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
export async function publicFilesUnder(
    root: string,
): Promise<Map<string, PublicFile>> {
    const files = new Map<string, PublicFile>()
    // NO PUBLIC DIRECTORY IS THE COMMON CASE, not an error: an app has none until its author adds
    // one, and `abide build` writes nothing where there is nothing to copy. `scanSync` throws on
    // a directory that is not there, and it threw at BOOT — so the whole app served nothing, over
    // a file it does not have. Narrowed to that one code for `shellUnder`'s reason: a directory
    // that exists and cannot be read is a different fault and must not read as an empty one.
    let names: string[]
    try {
        names = [...new Bun.Glob('**/*').scanSync({ cwd: root })]
    } catch (thrown) {
        if ((thrown as { code?: unknown }).code !== 'ENOENT') throw thrown
        return files
    }
    for (const name of names) {
        const path = `${root}/${name}`
        const bytes = await Bun.file(path).bytes()
        // Non-cryptographic, and that is the right tool: an etag answers "are these the same
        // bytes", not "could somebody forge these bytes".
        files.set(`/${name}`, {
            path,
            etag: `"${Bun.hash(bytes).toString(16)}"`,
        })
    }
    return files
}

export function notFound(): Response {
    return new Response('not found', { status: 404 })
}

// 35.5's generator, as a body. Pulled a chunk at a time rather than collected, which is the shape
// 41.1 needs and the reason `render` yields twice rather than returning a string.
//
// IT IS NOT AN EARLY FLUSH. `render` calls the component before its first yield, so the body is
// already built by the time the head chunk is pulled — what a reader gains today is that the head
// is a chunk of its own and goes out without waiting on the encode of the rest. 41.1 is the flush,
// it is not implemented, and it lands in `render` rather than here.
function streamOf(
    chunks: AsyncGenerator<Uint8Array>,
): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            const next = await chunks.next()
            if (next.done === true) controller.close()
            else controller.enqueue(next.value)
        },
    })
}

function match(
    routes: Ranked[],
    pathname: string,
): { route: Ranked; params: Params } | undefined {
    for (const route of routes) {
        const params = matchRoute(route.segments, pathname)
        if (params !== null) return { route, params }
    }
    return undefined
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
