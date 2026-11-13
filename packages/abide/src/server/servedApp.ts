// BOOTING AN APP FROM A COMPILATION: what every supplier — `abide start` off disk, `abide dev` out of
// memory, a compiled app out of itself, and a test over modules it holds — hands `bootApp`, and how
// the sources are assembled from what it hands. Where a part came from is the supplier's; how the
// app is assembled from it is here, once (`appSources`).
//
// THE ORDER IS THE PLUGIN, THEN THE TABLES, THEN THE HOOKS. The server's table is a module the
// compilation's plugin answers below `__abide` (`abideModules`), so it resolves only once that plugin
// is registered, and the hooks are the server blocks the table names. `serveApp` is the one way to
// that pair, and it registers before it reads.

import {
    APP_MANIFEST_ADDRESS,
    CLIENT_ADDRESS,
    WORKER_ADDRESS,
} from '#shared/ADDRESSES.ts'
import { APP_META } from '#shared/APP_META.ts'
import { DEBUG_META } from '#shared/DEBUG_META.ts'
import { ERROR_META } from '#shared/ERROR_META.ts'
import { escapeAttribute } from '#shared/escapeText.ts'
import { appName } from '#shared/log.ts'
import { MOUNT, mounted } from '#shared/mount.ts'
import { MOUNT_META } from '#shared/MOUNT_META.ts'
import { ICON_ADDRESSES } from '#shared/NATIVE_FILES.ts'
import { OFFLINE_META } from '#shared/OFFLINE_META.ts'
import { parseRoutePattern, rankRoutes } from '#shared/routePattern.ts'

import {
    type BuiltTable,
    type Compilation,
    serveCompilation,
    servedTable,
} from './abideModules.ts'
import { answerFailure } from './answerFailure.ts'
import {
    answerInside,
    type AppSources,
    type PublicFile,
    type Ranked,
    type RankedError,
    type RouteRow,
    type ServerTable,
} from './answerRequest.ts'
import { contentEtag } from './answerValue.ts'
import { answerWorker } from './answerWorker.ts'
import { appManifest } from './appManifest.ts'
import { CLIENT_ENTRY, ENCODING_SUFFIX } from './CLIENT_BUILD.ts'
import { bundleServer, type ServedFile } from './clientBundle.ts'
import { packageUnder, settingOn } from './config.ts'
import type { AppOrigin } from './createApp.ts'
import { rungsOver } from './hooks.ts'
import { chunksOf, type Manifest } from './manifestOf.ts'
import { mountHandlers, type MountRow } from './mountHandlers.ts'
import { ENCODINGS } from './negotiateEncoding.ts'
import { DEFAULT_DOCUMENT, intoHead } from './render.ts'

/** An app whose compilation this process serves: what it is entered as, and its server's table. */
export type ServedApp = { origin: AppOrigin; table: BuiltTable }

/**
 * Serves `compilation` to this process's imports, then reads the server's table out of it — the
 * app under `root`, ready to boot.
 *
 * REGISTERED BEFORE THE FIRST AWAIT, so a caller that starts other work against the plugin — `abide
 * dev`'s bundle — may start it as soon as this is called rather than once it settles.
 */
export async function serveApp(
    root: string,
    compilation: Compilation,
): Promise<ServedApp> {
    serveCompilation(root, compilation)
    const table = await servedTable(root)
    return {
        // 37.1 — every server block, imported for the hooks it files.
        origin: {
            hooks: () => Promise.all(table.servers.map((load) => load())),
            package: packageUnder(root),
        },
        table,
    }
}

/**
 * What `abide build` produced, as the parts an `App` is booted over.
 *
 * Read off disk by `abide start` (`servedBuild`), and out of the executable itself by a compiled app
 * (38.10). ONE SHAPE, so the two are answered by one path and differ only in where a byte is read
 * from — a file is a PATH in both, and `Bun.file` reads the executable's own the same way it reads
 * the disk's.
 */
export type BuildParts = Omit<SourceParts, 'client' | 'explained'> & {
    manifest: Manifest
    /** Every file under `client/`, the precompressed copies among them, by name to its path. */
    client: Map<string, string>
}

/** The sources an `App` is booted over, out of the parts `abide build` produced. */
export function builtSources(parts: BuildParts): Promise<AppSources> {
    // THE PRECOMPRESSED COPIES ARE NOT ADDRESSES OF THEIR OWN. They are the same file in another
    // encoding (38.5), so they are found under the name they encode and served as that name.
    const suffixes = Object.values(ENCODING_SUFFIX) as string[]
    const files = new Map<string, ServedFile>()
    for (const [name, path] of parts.client) {
        if (suffixes.some((suffix) => name.endsWith(suffix))) continue
        const encoded: ServedFile['encoded'] = {}
        for (const encoding of ENCODINGS) {
            const copy = parts.client.get(name + ENCODING_SUFFIX[encoding])
            if (copy !== undefined) encoded[encoding] = () => Bun.file(copy)
        }
        files.set(name, {
            // THE TYPE IS THE NAME'S, not the path's: a compiled app's path carries a hash the
            // bundler put before the extension, and a `.br`'s extension names nothing.
            type: Bun.file(name).type,
            body: () => Bun.file(path),
            encoded,
        })
    }
    return appSources({
        ...parts,
        explained: undefined,
        client: {
            manifest: parts.manifest,
            head: '',
            // 21.5 — EVERY NAME IN THE BUNDLE CARRIES A HASH OF ITS BYTES, the entry's too (38.5), so
            // a name never answers two different files and a year is safe for all of them. A deploy
            // is new names in a new document, never new bytes at an old address.
            framework: bundleServer(
                files,
                'public, max-age=31536000, immutable',
            ),
            offline: settingOn('ABIDE_OFFLINE'),
        },
    })
}

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
    /**
     * 45.1, 45.9 — whether the worker saves `manifest`'s bundle and the pages register it: `abide
     * build`'s, where `ABIDE_OFFLINE` is on. Where not, the worker address answers the removing one.
     */
    offline: boolean
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
    // 45.15 — installable where the pages are kept offline and the app has an icon to install by.
    const icon = published.get(ICON_ADDRESSES.png)
    const install =
        icon !== undefined && settingOn('ABIDE_OFFLINE')
            ? await appManifest(icon.path)
            : undefined
    const documentOf = (modules: string[]): string =>
        intoHead(
            DEFAULT_DOCUMENT,
            clientTags(client.manifest, modules) +
                (client.offline ? `<meta name="${OFFLINE_META}">` : '') +
                (install?.tags ?? '') +
                client.head,
        )
    const pages: Omit<Ranked, 'segments'>[] = []
    for (const route of parts.table.routes)
        pages.push({
            pattern: route.pattern,
            load: route.load,
            layouts: route.layouts,
            matchers: route.matchers,
            document: documentOf(route.clientModules),
        })
    // 19.1 — the build refused two files at one route and method, so a route is one row however
    // many methods answer at it — and 23.27 one matcher per position, so whichever file opens the
    // row brings what every file at it would.
    const rows = new Map<string, Omit<RouteRow, 'segments'>>()
    const rowAt = (
        pattern: string,
        matchers: Record<string, string>,
    ): Omit<RouteRow, 'segments'> => {
        let row = rows.get(pattern)
        if (row === undefined) {
            row = {
                pattern,
                matchers,
                page: undefined,
                handlers: new Map(),
                answers: new Map(),
            }
            rows.set(pattern, row)
        }
        return row
    }
    for (const page of rankRoutes(pages))
        rowAt(page.pattern, page.matchers).page = page
    for (const handler of mounted.handlers.values())
        rowAt(handler.address, handler.matchers).handlers.set(
            handler.method,
            handler,
        )
    const errors: RankedError[] = []
    for (const error of parts.table.errors)
        errors.push({
            ...error,
            segments: parseRoutePattern(error.pattern, error.matchers),
        })
    errors.sort((a, b) => b.segments.length - a.segments.length)
    const sources: AppSources = {
        routes: rankRoutes([...rows.values()]),
        errors,
        // 35.18 — marked, so the browser hydrates no page over what an error page painted.
        errorDocument: intoHead(documentOf([]), `<meta name="${ERROR_META}">`),
        framework: (pathname, request) => {
            if (pathname === WORKER_ADDRESS)
                return answerWorker(
                    client.offline ? client.manifest : undefined,
                )
            if (pathname === APP_MANIFEST_ADDRESS && install !== undefined)
                return new Response(install.body, {
                    headers: {
                        'content-type': 'application/manifest+json',
                        'cache-control': 'no-cache',
                    },
                })
            return client.framework(pathname, request)
        },
        published,
        explained: parts.explained,
        offline: client.offline,
        ...mounted,
    }
    for (const row of sources.routes) {
        if (row.page !== undefined)
            row.answers.set(
                row.page,
                answerInside(
                    sources,
                    row.page,
                    // 37.14 — a page's lane paints a refusal as its error page does (35.2).
                    rungsOver(row.pattern, (failure, request) =>
                        answerFailure(
                            sources,
                            new URL(request.url).pathname,
                            failure,
                            request,
                        ),
                    ),
                ),
            )
        for (const handler of row.handlers.values())
            row.answers.set(
                handler,
                answerInside(sources, handler, handler.rungs),
            )
    }
    return sources
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
