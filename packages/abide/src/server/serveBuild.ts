// 38.6 — `abide start`: the built app, over http. The request path is `answerRequest`'s, shared
// with `abide dev`; what this module is, is the SUPPLIER — where each part comes from when the
// parts are what `abide build` left on disk.
//
// THE ROUTE TABLE IS THE BUILD'S, not this module's. `abide build` walks the tree once and writes
// what it found, so the addresses the server answers and the addresses the client router knows
// are two readings of one walk rather than two walks that have to agree (30.8).

import { CLIENT_ADDRESS } from '#shared/ADDRESSES.ts'
import {
    appSources,
    type LoadedSources,
    publicFilesUnder,
    type ServerTable,
} from './answerRequest.ts'
import { type Mount, mountHandlers } from './answerRpc.ts'
import {
    CLIENT_DIRECTORY,
    ENCODING_SUFFIX,
    MANIFEST,
    PUBLIC_DIRECTORY,
} from './CLIENT_BUILD.ts'
import type { Manifest } from './chunksByModule.ts'
import { bootApp } from './createApp.ts'
import { namesUnder } from './namesUnder.ts'
import {
    ENCODINGS,
    type Encoding,
    negotiateEncoding,
} from './negotiateEncoding.ts'
import { shellUnder } from './render.ts'
import { LISTENING } from './requestScope.ts'

export type ServeOptions = {
    // The app's source root — the directory `ui/` and `server/` sit under, and the one 35.6's
    // shell is resolved against.
    root: string
    // Where `abide build` put its output.
    out: string
    port?: number | undefined
}

// 38.6 — `abide start`: the built app, booted (`bootApp`) and listening. What `App.listen` bound is
// handed back, for the command to say where.
export async function serveBuild(
    options: ServeOptions,
): Promise<Bun.Server<unknown>> {
    const app = await bootApp(options.root, () => loadBuild(options))
    await app.listen(options.port === undefined ? {} : { port: options.port })
    return LISTENING.server as Bun.Server<unknown>
}

// THE ROUTE TABLE AND THE MOUNTED HANDLERS, out of the directory the compiled modules sit in — on
// disk for `abide start`, and the dev worker's virtual one (38.17). 16.2 — the handlers answered
// out of the app's own source, and 18.2's sockets among them, mounted as soon as they load.
export function loadTables(
    directory: string,
    root: string,
): Promise<[ServerTable, Awaited<ReturnType<typeof mountHandlers>>]> {
    return Promise.all([
        import(
            Bun.pathToFileURL(`${directory}/server.ts`).href
        ) as Promise<ServerTable>,
        (
            import(Bun.pathToFileURL(`${directory}/rpc.ts`).href) as Promise<{
                handlers: Mount[]
            }>
        ).then((rpc) => mountHandlers(rpc.handlers, root)),
    ])
}

// WHAT `abide build` LEFT ON DISK, as the parts an `App` is booted over.
export async function loadBuild(
    options: Pick<ServeOptions, 'root' | 'out'>,
): Promise<LoadedSources> {
    if (!(await Bun.file(`${options.out}/server.ts`).exists()))
        throw new Error(
            `abide: no build at ${options.out}. Run \`abide build\` first.`,
        )
    // THE BOOT READS OVERLAP: the route table, the handler table, the shell, the manifest and the
    // public files are independent of each other, and this is the whole of `abide start`'s boot.
    //
    // THE SHELL IS READ ONCE, at boot. `render`'s own note prices the per-render read at 98% of the
    // op and leaves the caching to whatever server got written; this is that server. The manifest
    // names the stylesheet only where the bundler collected one, so an app that imports none links
    // none.
    const [[table, mountedHandlers], shell, manifest, published] =
        await Promise.all([
            loadTables(options.out, options.root),
            shellUnder(options.root),
            Bun.file(`${options.out}/${MANIFEST}`).json() as Promise<Manifest>,
            publicFilesUnder(`${options.out}/${PUBLIC_DIRECTORY}`),
        ])

    // THE BUNDLE, ENUMERATED RATHER THAN RESOLVED. A request names a file in this set or it names
    // nothing — there is no path to normalise, so `..` is not a case that has to be got right,
    // and what is servable is exactly what the build produced.
    //
    // THE PRECOMPRESSED COPIES ARE NOT ADDRESSES OF THEIR OWN. They are the same file in another
    // encoding (38.5), so they are found under the name they encode and served as that name.
    const clientRoot = `${options.out}/${CLIENT_DIRECTORY}`
    const suffixes = Object.values(ENCODING_SUFFIX) as string[]
    const found = new Set(namesUnder(clientRoot))
    const assets = new Map<string, Encoding[]>()
    for (const name of found) {
        if (suffixes.some((suffix) => name.endsWith(suffix))) continue
        const encodings: Encoding[] = []
        for (const encoding of ENCODINGS)
            if (found.has(name + ENCODING_SUFFIX[encoding]))
                encodings.push(encoding)
        assets.set(name, encodings)
    }

    return appSources(table, shell, manifest, '', {
        framework: (pathname, request) => {
            if (!pathname.startsWith(`${CLIENT_ADDRESS}/`)) return undefined
            const name = pathname.slice(CLIENT_ADDRESS.length + 1)
            const encodings = assets.get(name)
            if (encodings === undefined) return undefined
            const file = Bun.file(`${clientRoot}/${name}`)
            // 21.5 — EVERY NAME IN THE BUNDLE CARRIES A HASH OF ITS BYTES, the entry's too (38.5),
            // so a name never answers two different files and a year is safe for all of them. A
            // deploy is new names in a new document, never new bytes at an old address.
            const headers: Record<string, string> = {
                'cache-control': 'public, max-age=31536000, immutable',
                'content-type': file.type,
                vary: 'accept-encoding',
            }
            // 38.30 — the precompressed copy where the request takes its encoding. The type is
            // the ORIGINAL's, since `Bun.file` reads a `.br` as nothing it can name.
            const encoding = negotiateEncoding(
                request.headers.get('accept-encoding'),
                encodings,
            )
            if (encoding === undefined) return new Response(file, { headers })
            headers['content-encoding'] = encoding
            return new Response(
                Bun.file(`${clientRoot}/${name}${ENCODING_SUFFIX[encoding]}`),
                { headers },
            )
        },
        published,
        ...mountedHandlers,
    })
}
