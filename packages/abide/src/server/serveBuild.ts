// 38.6 — `abide start`: the built app, over http. The request path is `answerRequest`'s, shared
// with `abide dev`; what this module is, is the SUPPLIER — where each part comes from when the
// parts are what `abide build` left on disk.
//
// THE ROUTE TABLE IS THE BUILD'S, not this module's. `abide build` walks the tree once and writes
// what it found, so the addresses the server answers and the addresses the client router knows
// are two readings of one walk rather than two walks that have to agree (30.8).

import {
    type AppSources,
    answerRequest,
    clientTags,
    intoHead,
    notFound,
    publicFilesUnder,
    rankRoutes,
    type ServerRoute,
} from './answerRequest.ts'
import {
    CLIENT_ADDRESS,
    CLIENT_DIRECTORY,
    CLIENT_ENTRY,
    PUBLIC_DIRECTORY,
} from './CLIENT_BUILD.ts'
import { shellUnder } from './render.ts'

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
    const app: AppSources = {
        routes: rankRoutes(table.routes),
        shell: intoHead(
            await shellUnder(options.root),
            clientTags(assets.has(`${CLIENT_ENTRY}.css`)),
        ),
        framework: (pathname) => {
            if (!pathname.startsWith(`${CLIENT_ADDRESS}/`)) return notFound()
            const name = pathname.slice(CLIENT_ADDRESS.length + 1)
            if (!assets.has(name)) return notFound()
            // 21.5 — the bundle is content-addressed by the chunk names the bundler picked, so a
            // year is safe for a chunk. `entry.js` is NOT hashed yet (38.5), which makes this the
            // shape rather than the guarantee and is why it is commented rather than just written.
            return new Response(Bun.file(`${clientRoot}/${name}`), {
                headers: {
                    'cache-control': 'public, max-age=31536000, immutable',
                },
            })
        },
        published: await publicFilesUnder(`${options.out}/${PUBLIC_DIRECTORY}`),
    }

    const fetch = (request: Request): Promise<Response> =>
        answerRequest(app, request)

    // SPREAD RATHER THAN PASSED AS `undefined`. `Bun.serve` with no port reads `PORT` and then
    // falls back to 3000, and a key present and undefined is not the same as an absent one.
    return options.port === undefined
        ? Bun.serve({ fetch })
        : Bun.serve({ port: options.port, fetch })
}
