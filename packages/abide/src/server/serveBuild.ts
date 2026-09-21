// 38.6 — `abide start`: the built app, over http. This is the whole request path today, and what
// it is NOT is worth stating, since the rulebook describes a much larger one. There is no `App`
// (42), no middleware onion (16.15), no rpc over the wire (16.29) and no lifecycle hook (37):
// those want a request scope, and a request scope is the next thing rather than a gap in this one.
// What is here is a document, painted by the page the address matched, with the client bundle
// that hydrates it.
//
// THE ROUTE TABLE IS THE BUILD'S, not this module's. `abide build` walks the tree once and writes
// what it found, so the addresses the server answers and the addresses the client router knows
// are two readings of one walk rather than two walks that have to agree (30.8).

import { matchRoute, type Params } from '#shared/matchRoute.ts'
import {
    compareRoutes,
    parseRoutePattern,
    type Segment,
} from '#shared/routePattern.ts'
import {
    CLIENT_ADDRESS,
    CLIENT_DIRECTORY,
    CLIENT_ENTRY,
    PUBLIC_DIRECTORY,
} from './CLIENT_BUILD.ts'
import { type Component, headAnchor, render, shellUnder } from './render.ts'

// One row of the table `abide build` writes to `<out>/server.ts`. The loader is a dynamic import
// so a page's markup is off the boot path until an address asks for it, which is the same reason
// the client table's loaders are (30.11).
type ServerRoute = {
    pattern: string
    load: () => Promise<{ default: Component }>
}

type Compiled = {
    pattern: string
    segments: Segment[]
    load: ServerRoute['load']
}

export type ServeOptions = {
    // The app's source root — the directory `ui/` and `server/` sit under, and the one 35.6's
    // shell is resolved against.
    root: string
    // Where `abide build` put its output.
    out: string
    port?: number | undefined
}

export async function serveBuild(
    options: ServeOptions,
): Promise<Bun.Server<undefined>> {
    const table = (await import(
        Bun.pathToFileURL(`${options.out}/server.ts`).href
    )) as { routes: ServerRoute[] }

    // 30.9 — MOST SPECIFIC FIRST, ranked here rather than in the emitted table, so the ordering is
    // the client router's own and the two cannot resolve one address differently.
    const routes: Compiled[] = []
    for (const route of table.routes)
        routes.push({
            pattern: route.pattern,
            segments: parseRoutePattern(route.pattern),
            load: route.load,
        })
    routes.sort((a, b) => compareRoutes(a.segments, b.segments))

    // THE BUNDLE, ENUMERATED RATHER THAN RESOLVED. A request names a file in this set or it names
    // nothing — there is no path to normalise, so `..` is not a case that has to be got right,
    // and what is servable is exactly what the build produced.
    const clientRoot = `${options.out}/${CLIENT_DIRECTORY}`
    const assets = new Set<string>()
    for (const name of new Bun.Glob('**/*').scanSync({ cwd: clientRoot }))
        assets.add(name)

    // READ ONCE, at boot. `render`'s own note prices the per-render read at 98% of the op and
    // leaves the caching to whatever server got written; this is that server. The stylesheet is
    // asked for here rather than assumed: an app that imports none has no `entry.css` and the
    // document must not link one.
    const shell = withClientEntry(
        await shellUnder(options.root),
        assets.has(`${CLIENT_ENTRY}.css`),
    )

    const published = await publicFiles(`${options.out}/${PUBLIC_DIRECTORY}`)

    async function fetch(request: Request): Promise<Response> {
        const asked = new URL(request.url).pathname

        if (asked.startsWith(`${CLIENT_ADDRESS}/`)) {
            const name = asked.slice(CLIENT_ADDRESS.length + 1)
            if (!assets.has(name)) return notFound()
            // 21.5 — the bundle is content-addressed by the chunk names the bundler picked, so a
            // year is safe for a chunk. `entry.js` is NOT hashed yet (38.5), which makes this the
            // shape rather than the guarantee and is why it is commented rather than just written.
            return new Response(Bun.file(`${clientRoot}/${name}`), {
                headers: {
                    'cache-control': 'public, max-age=31536000, immutable',
                },
            })
        }

        // 36.11 — A PUBLIC FILE IS ITS PATH BELOW THE DIRECTORY, so `/favicon.ico` is answered
        // before any route is tried. The order is not load-bearing: 36.13 makes a collision
        // between the two a build error, so at run time there can never be one to resolve.
        const file = published.get(asked)
        if (file !== undefined) return publicResponse(request, file)

        const found = match(routes, asked)
        // 38.22. The client router leaves an unmatched address to the document (30.10), so this
        // is where that address arrives and there is nothing behind it.
        if (found === undefined) return notFound()

        const { default: page } = await found.route.load()
        // 35.4 — BOUND HERE, because `render` takes a component that already has its props.
        // 33.4 — a prop is an ACCESSOR, which is the contract `renderComponent` renders a child
        // under and the one the client router mounts a page under; the params are the record
        // `matchRoute` hands the client for this same address.
        const bound = (): unknown =>
            (page as (props: Record<string, () => unknown>) => unknown)({
                params: () => found.params,
            })
        return new Response(streamOf(render(bound, shell)), {
            headers: { 'content-type': 'text/html; charset=utf-8' },
        })
    }

    // SPREAD RATHER THAN PASSED AS `undefined`. `Bun.serve` with no port reads `PORT` and then
    // falls back to 3000, and a key present and undefined is not the same as an absent one.
    return options.port === undefined
        ? Bun.serve({ fetch })
        : Bun.serve({ port: options.port, fetch })
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

function notFound(): Response {
    return new Response('not found', { status: 404 })
}

function match(
    routes: Compiled[],
    pathname: string,
): { route: Compiled; params: Params } | undefined {
    for (const route of routes) {
        const params = matchRoute(route.segments, pathname)
        if (params !== null) return { route, params }
    }
    return undefined
}

// THE SHELL LOADS THE APP — 38.23, and 38.24 for the stylesheet beside it. An app does not write
// either tag: the bundle's address is the build's, and a hand-written one is a path that goes
// stale the first time the output layout moves. At the head anchor `render` uses, so a shell with
// no `</head>` puts them where its head content goes rather than inside the body.
//
// THE STYLESHEET GOES FIRST, and ahead of the page's own head contributions for the same reason:
// a document that parses its script before its styles paints once unstyled. It is a plain `<link>`
// rather than anything the client does, so a page the server painted is styled with no JS at all.
//
// ONE STYLESHEET FOR THE APP, which is NOT 34.5's per-component dependency: the bundler collects
// every stylesheet reachable from the entry into one file, so a page that imports none is served
// this too. 34.3's scope token is what makes that distinction matter and it is not built.
function withClientEntry(shell: string, styled: boolean): string {
    const at = headAnchor(shell)
    const link = styled
        ? `<link rel="stylesheet" href="${CLIENT_ADDRESS}/${CLIENT_ENTRY}.css">`
        : ''
    const script = `<script type="module" src="${CLIENT_ADDRESS}/${CLIENT_ENTRY}.js"></script>`
    return shell.slice(0, at) + link + script + shell.slice(at)
}

// 38.19's output, as an address per file. Read at boot rather than per request, and the ETAG IS
// READ WITH IT: 21.13 derives it from the bytes, so there is no cheaper moment than the one read
// that is happening anyway. The bytes are hashed and dropped — `Bun.file` streams the body when
// somebody asks, so a large file is not held in memory for the life of the process.
async function publicFiles(
    root: string,
): Promise<Map<string, { path: string; etag: string }>> {
    const files = new Map<string, { path: string; etag: string }>()
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

function publicResponse(
    request: Request,
    file: { path: string; etag: string },
): Response {
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
