// 38.6 and 38.11 — `abide start` and a compiled app: the built app, over http. The request path is
// `answerRequest`'s, shared with `abide dev`; what this module is, is the SUPPLIER — where each part
// comes from when the parts are what `abide build` produced.
//
// THE ROUTE TABLE IS THE BUILD'S, not this module's. `abide build` walks the tree once and writes
// what it found, so the addresses the server answers and the addresses the client router knows
// are two readings of one walk rather than two walks that have to agree (30.8).

import { CLIENT_ADDRESS } from '#shared/ADDRESSES.ts'
import {
    appSources,
    type LoadedSources,
    publicFilesAt,
    type ServerTable,
} from './answerRequest.ts'
import { type Mount, mountHandlers } from './answerRpc.ts'
import {
    CLIENT_DIRECTORY,
    ENCODING_SUFFIX,
    MANIFEST,
    PUBLIC_DIRECTORY,
} from './CLIENT_BUILD.ts'
import { type App, type AppOrigin, bootApp } from './createApp.ts'
import type { Manifest } from './manifestOf.ts'
import { namesUnder } from './namesUnder.ts'
import {
    ENCODINGS,
    type Encoding,
    negotiateEncoding,
} from './negotiateEncoding.ts'
import { shellUnder } from './render.ts'
import { stopOnSignalOrFault } from './stopOnSignalOrFault.ts'

/**
 * What `abide build` produced, as the parts an `App` is booted over.
 *
 * Read off disk by `abide start` (`loadBuild`), and out of the executable itself by a compiled app
 * (38.11). ONE SHAPE, so the two are answered by one path and differ only in where a byte is read
 * from — a file is a PATH in both, and `Bun.file` reads the executable's own the same way it reads
 * the disk's.
 */
export type BuildParts = {
    table: ServerTable
    handlers: Mount[]
    /** A handler's module, by the source path its row names. 16.2. */
    handlerModule: (source: string) => Promise<Record<string, unknown>>
    shell: string
    manifest: Manifest
    /** Every file under `client/`, the precompressed copies among them, by name to its path. */
    client: Map<string, string>
    /** Every public file, by name to its path. 38.19. */
    published: Map<string, string>
}

/**
 * The app booted (`bootApp`) and listening, stopped on a signal or an unawaited fault.
 *
 * Listening on `LISTENING.server`, for the caller to say where.
 */
export async function serveApp(
    origin: AppOrigin,
    load: () => Promise<LoadedSources>,
    port: number | undefined,
): Promise<App> {
    const app = await bootApp(origin, load)
    await app.listen(port === undefined ? {} : { port })
    // ONCE SERVING, and not before: a boot that fails is 37.6's to fail hard.
    stopOnSignalOrFault(app)
    return app
}

/** A loader for a handler's module, out of the app's source tree. */
export function sourceModuleLoader(
    root: string,
): (source: string) => Promise<Record<string, unknown>> {
    return (source) => import(Bun.pathToFileURL(`${root}/${source}`).href)
}

/**
 * The route table and the mounted handlers, out of the dev worker's virtual directory.
 *
 * 38.17. 16.2 — the handlers answered out of the app's own source, and 18.2's sockets among them,
 * mounted as soon as they load.
 */
export function loadTables(
    directory: string,
    root: string,
): Promise<[ServerTable, Awaited<ReturnType<typeof mountHandlers>>]> {
    return Promise.all([
        import(
            Bun.pathToFileURL(`${directory}/server.ts`).href
        ) as Promise<ServerTable>,
        handlersIn(directory).then((handlers) =>
            mountHandlers(handlers, sourceModuleLoader(root)),
        ),
    ])
}

/** The handler table a build wrote into `directory`. */
export async function handlersIn(directory: string): Promise<Mount[]> {
    const rpc = (await import(
        Bun.pathToFileURL(`${directory}/rpc.ts`).href
    )) as {
        handlers: Mount[]
    }
    return rpc.handlers
}

/** What `abide build` left on disk, as the sources an `App` is booted over. */
export async function loadBuild(options: {
    /**
     * The app's source root — the directory `ui/` and `server/` sit under, and the one 35.6's
     * shell is resolved against.
     */
    root: string
    /** Where `abide build` put its output. */
    out: string
}): Promise<LoadedSources> {
    if (!(await Bun.file(`${options.out}/server.ts`).exists()))
        throw new Error(
            `abide: no build at ${options.out}. Run \`abide build\` first.`,
        )
    // THE BOOT READS OVERLAP: the route table, the handler table, the shell and the manifest are
    // independent of each other.
    //
    // THE SHELL IS READ ONCE, at boot. `render`'s own note prices the per-render read at 98% of the
    // op and leaves the caching to whatever server got written; this is that server. The manifest
    // names the stylesheet only where the bundler collected one, so an app that imports none links
    // none.
    const [table, handlers, shell, manifest] = await Promise.all([
        import(
            Bun.pathToFileURL(`${options.out}/server.ts`).href
        ) as Promise<ServerTable>,
        handlersIn(options.out),
        shellUnder(options.root),
        Bun.file(`${options.out}/${MANIFEST}`).json() as Promise<Manifest>,
    ])
    return builtSources({
        table,
        handlers,
        handlerModule: sourceModuleLoader(options.root),
        shell,
        manifest,
        client: pathsUnder(`${options.out}/${CLIENT_DIRECTORY}`),
        published: pathsUnder(`${options.out}/${PUBLIC_DIRECTORY}`),
    })
}

/** Every file under `directory`, by the name below it to its path. */
export function pathsUnder(directory: string): Map<string, string> {
    const paths = new Map<string, string>()
    for (const name of namesUnder(directory))
        paths.set(name, `${directory}/${name}`)
    return paths
}

/** The sources an `App` is booted over, out of the parts `abide build` produced. */
export async function builtSources(parts: BuildParts): Promise<LoadedSources> {
    const [mountedHandlers, published] = await Promise.all([
        mountHandlers(parts.handlers, parts.handlerModule),
        publicFilesAt(parts.published),
    ])

    // THE BUNDLE, ENUMERATED RATHER THAN RESOLVED. A request names a file in this set or it names
    // nothing — there is no path to normalise, so `..` is not a case that has to be got right,
    // and what is servable is exactly what the build produced.
    //
    // THE PRECOMPRESSED COPIES ARE NOT ADDRESSES OF THEIR OWN. They are the same file in another
    // encoding (38.5), so they are found under the name they encode and served as that name.
    const suffixes = Object.values(ENCODING_SUFFIX) as string[]
    const assets = new Map<string, Encoding[]>()
    for (const name of parts.client.keys()) {
        if (suffixes.some((suffix) => name.endsWith(suffix))) continue
        const encodings: Encoding[] = []
        for (const encoding of ENCODINGS)
            if (parts.client.has(name + ENCODING_SUFFIX[encoding]))
                encodings.push(encoding)
        assets.set(name, encodings)
    }

    return appSources(parts.table, parts.shell, parts.manifest, '', {
        explained: undefined,
        framework: (pathname, request) => {
            if (!pathname.startsWith(`${CLIENT_ADDRESS}/`)) return undefined
            const name = pathname.slice(CLIENT_ADDRESS.length + 1)
            const encodings = assets.get(name)
            if (encodings === undefined) return undefined
            // THE TYPE IS THE NAME'S, not the path's: a compiled app's path carries a hash the
            // bundler put before the extension, and a `.br`'s extension names nothing.
            const type = Bun.file(name).type
            // 21.5 — EVERY NAME IN THE BUNDLE CARRIES A HASH OF ITS BYTES, the entry's too (38.5),
            // so a name never answers two different files and a year is safe for all of them. A
            // deploy is new names in a new document, never new bytes at an old address.
            const headers: Record<string, string> = {
                'cache-control': 'public, max-age=31536000, immutable',
                'content-type': type,
                vary: 'accept-encoding',
            }
            // 38.30 — the precompressed copy where the request takes its encoding.
            const encoding = negotiateEncoding(
                request.headers.get('accept-encoding'),
                encodings,
            )
            if (encoding === undefined)
                return new Response(
                    Bun.file(parts.client.get(name) as string),
                    { headers },
                )
            headers['content-encoding'] = encoding
            return new Response(
                Bun.file(
                    parts.client.get(
                        name + ENCODING_SUFFIX[encoding],
                    ) as string,
                ),
                { headers },
            )
        },
        published,
        ...mountedHandlers,
    })
}
