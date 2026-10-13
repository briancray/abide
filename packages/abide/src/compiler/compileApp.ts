import { existsSync, readFileSync, realpathSync } from 'node:fs' // bun exposes no sync existence check, read or realpath of its own
import { dirname, posix, relative as relativeTo } from 'node:path' // bun exposes no path helpers of its own
import {
    type Compilation,
    type CompiledFile,
    resolvedFile,
} from '#server/abideModules.ts'
import type { Mount } from '#server/answerRpc.ts'
import { abideUnder, appFiles } from '#server/appTree.ts'
import { CLIENT_ENTRY } from '#server/CLIENT_BUILD.ts'
import { COMPONENT_QUERY } from '#server/MODULE_QUERIES.ts'
import { ROUTES_TABLE, SERVER_TABLE } from '#server/TABLES.ts'
import { VIRTUAL_DIRECTORY } from '#server/VIRTUAL_DIRECTORY.ts'
import { CLIENT_ADDRESS } from '#shared/ADDRESSES.ts'
import { LAUNCHER_PAGE } from '#shared/LAUNCHER_FILES.ts'
import {
    coversRoute,
    parseRoutePattern,
    placeOf,
    routeOf,
    type Segment,
} from '#shared/routePattern.ts'
import {
    ROUTING_SPECIFIER,
    SHARED_SPECIFIER,
    WIRE_SPECIFIER,
} from '#shared/SPECIFIERS.ts'
import { abideImportsOf, appGraph } from './componentGraph.ts'
import { emitSource } from './emitSource.ts'
import { formatDiagnosis } from './formatDiagnosis.ts'
import {
    type HandlerFile,
    handlersUnder,
    type Refuse,
    THROW,
} from './handlersUnder.ts'
import { hooksCalled } from './hooksCalled.ts'
import { mountsOf } from './mountsOf.ts'
import { nearest } from './nearest.ts'
import type { AbideFile } from './parseAbide.ts'
import {
    type ParsedSource,
    parseSources,
    type ReadSource,
    readSources,
    refusal,
} from './readSources.ts'
import { importStatements, respecified } from './splitImports.ts'
import { type Diagnosis, TypeSession } from './TypeSession.ts'
import { writeDefaultProject } from './writeDefaultProject.ts'

// AN APP'S `.abide` SOURCES, COMPILED — every file keyed by its path below the root, and loaded
// there through its `?component` face (`abideModules`). Nothing here touches the output directory:
// `abide build` writes what this hands back and `abide dev` keeps it in memory (38.16), and the two
// commands serving different markup from the same sources is exactly what one compile in two sinks
// makes impossible.

type AppRoute = {
    /** The address, in the bracket spelling `routePattern` parses. */
    pattern: string
    /** The `.abide` this route paints, relative to the app root. */
    source: string
    /**
     * 35.1 — the `layout.abide` files this page renders inside, outermost first.
     *
     * A fact about the file tree, like the address itself, so a layout cannot be forgotten and
     * cannot be declared twice.
     */
    layouts: string[]
}

/** An app's compiled output: every file and table (`Compilation`), its routes, and its warnings. */
export type CompiledApp = Compilation & {
    routes: AppRoute[]
    /** Every handler, where it is mounted. 16.2. */
    mounts: Mount[]
    /** How many `.abide` files were read, which is what the commands report. */
    sources: number
    /** What the compiler has to say that does not stop the build, on the `.abide` line. */
    warnings: Diagnosis[]
    /** Every public file's source path to its address, as `appFiles` read them. 36.11. */
    published: Map<string, string>
}

/**
 * The checker an app is typed with, kept open across compiles where the caller holds it.
 *
 * `abide build` opens one for its one compile; `abide dev` and `abide lsp` keep one for as long as
 * they run, because spawning it is most of what a compile costs — and a kept checker answers from
 * the text it cached, so each is told what its watcher saw move.
 */
export type AppChecker = {
    session: TypeSession
    /** The app's root, real — every path a checker is asked about is spelled under it. */
    root: string
    /**
     * Records a path a watcher saw move, or `undefined` for a move it could not place.
     *
     * Held until `current`.
     */
    saw: (path: string | undefined) => void
    /**
     * The app's own `.abide`, read (`sourcesUnder`) — kept until `saw` hears anything move, so a
     * check asked again and again while an editor types re-reads nothing on disk.
     */
    sources: () => ReturnType<typeof sourcesUnder>
    /**
     * Whether the project it was opened on is still the app's; if so, flushes what `saw` held.
     *
     * The same nearest tsconfig and package.json, neither touched since. Asked rather than heard,
     * because either can sit above the watched root — the dogfood's do — and either changes what
     * every file resolves to. Where it is, the session is told every move `saw` held
     * (`TypeSession.edited`); where it is not, the caller opens another.
     */
    current: () => boolean
    close: () => Promise<void>
}

/**
 * Opens the checker for the app at `appRoot`, on a default tsconfig where it has none (38.30).
 *
 * AT ITS REAL PATH, which is the one bun resolves every import to: an editor holding the app
 * through a link (`/tmp` is one on macOS) is spelled back at its own edge (`serveLanguage`).
 */
export async function openChecker(appRoot: string): Promise<AppChecker> {
    const root = realpathSync(appRoot)
    // Where the app has no tsconfig it is typed against a default one (38.30), so every app is
    // read by the same compiler.
    const found = nearest(root, 'tsconfig.json')
    const opened = projectFiles(root)
    const project =
        found === undefined
            ? await writeDefaultProject(root)
            : { tsconfig: found, remove: async (): Promise<void> => {} }
    const session = await TypeSession.open(project.tsconfig)
    session.root = root
    const moved = new Set<string>()
    let movedSomewhere = false
    let sources: ReturnType<typeof sourcesUnder> | undefined
    return {
        session,
        root,
        saw: (path) => {
            sources = undefined
            if (path === undefined) movedSomewhere = true
            else moved.add(path)
        },
        sources: () => {
            sources ??= sourcesUnder(root).catch((thrown: unknown) => {
                sources = undefined
                throw thrown
            })
            return sources
        },
        current: () => {
            if (projectFiles(root) !== opened) return false
            if (movedSomewhere || moved.size > 0)
                session.edited(movedSomewhere ? undefined : [...moved])
            moved.clear()
            movedSomewhere = false
            return true
        },
        close: async () => {
            await session.close()
            await project.remove()
        },
    }
}

/** The nearest tsconfig and package.json, each with when it was last written, as one string. */
function projectFiles(root: string): string {
    let files = ''
    for (const name of ['tsconfig.json', 'package.json']) {
        const path = nearest(root, name)
        files += `${path}:${path === undefined ? 0 : Bun.file(path).lastModified}\n`
    }
    return files
}

/**
 * Runs `run` with a checker: `kept` where given, or one opened for the run and closed after it.
 *
 * `kept` is one the caller holds across runs and closes itself; one opened here is closed whatever
 * `run` did.
 */
export async function withChecker<Result>(
    root: string,
    kept: AppChecker | undefined,
    run: (session: TypeSession) => Promise<Result>,
): Promise<Result> {
    const checker = kept ?? (await openChecker(root))
    try {
        return await run(checker.session)
    } finally {
        if (kept === undefined) await checker.close()
    }
}

/**
 * Every `.abide` of the app's own, read, in path order — and the root as bun resolves it.
 *
 * `Bun.resolveSync` answers a symlink-free path (`/tmp` is `/private/tmp` on macOS), so a root
 * spelled through a link would have every import resolve to a file this walk never listed, and
 * every component read as uninvoked. THE READS OVERLAP: nothing a source is read for depends on
 * another, and this runs again on every `abide dev` save.
 */
export async function sourcesUnder(
    appRoot: string,
): Promise<{ root: string; sources: { path: string; text: string }[] }> {
    const root = realpathSync(appRoot)
    return { root, sources: await sourcesAt(root, abideUnder(root)) }
}

/** The `.abide` at each of `relatives`, below `root`, read. */
async function sourcesAt(
    root: string,
    relatives: readonly string[],
): Promise<{ path: string; text: string }[]> {
    const paths: string[] = []
    for (const path of relatives) paths.push(`${root}/${path}`)
    const texts = await Promise.all(paths.map((path) => Bun.file(path).text()))
    const sources: { path: string; text: string }[] = []
    for (let at = 0; at < paths.length; at += 1)
        sources.push({ path: paths[at] as string, text: texts[at] as string })
    return sources
}

/**
 * `parsed` and every `.abide` outside them that one of them imports — a dependency's, or a linked
 * package's — parsed, and every one those import in turn; and every `.abide` under a directory one
 * of them mounts, at the position the mount gives it (23.19). With them, the app's own handler files
 * — `own`, below `root`, as its walk found them (`appFiles`) — and every one a mounted directory
 * holds, each at the position it answers by.
 *
 * 34.23 — COMPILED WITH THE APP, by the app's checker, so a component a package ships as source is
 * one of the app's in every way but its address: it is never routed (`placeOf`) unless mounted.
 */
export async function withDependencies(
    root: string,
    parsed: readonly ParsedSource[],
    own: readonly string[],
    resolve: (specifier: string, from: string) => string | undefined,
    refused?: Diagnosis[],
): Promise<{
    sources: ParsedSource[]
    handlers: HandlerFile[]
    mounted: Compilation['mounted']
}> {
    const all = [...parsed]
    const handlers: HandlerFile[] = []
    for (const relative of own)
        handlers.push({
            path: `${root}/${relative}`,
            relative,
            position: relative,
        })
    // The mounted handler files placed so far; the app's own is never mounted (23.20).
    const handled = new Set<string>()
    const mounted: Compilation['mounted'] = {}
    const byPath = new Map<string, ParsedSource>()
    for (const source of all) byPath.set(source.path, source)
    // 23.20 — a directory mounts once, and by whom.
    const mountedBy = new Map<string, string>()
    const refuse = (path: string, message: string): void => {
        if (refused === undefined) throw new Error(message)
        refused.push(refusal(path, new Error(message)))
    }
    const add = async (found: {
        path: string
        position?: string
    }): Promise<void> => {
        const text = await Bun.file(found.path).text()
        for (const one of parseSources([{ ...found, text }], refused)) {
            byPath.set(one.path, one)
            all.push(one)
        }
    }
    for (let at = 0; at < all.length; at += 1) {
        const source = all[at] as ParsedSource
        const position = source.position ?? relativeTo(root, source.path)
        const mounts = mountsOf(root, source.path, position, source.file)
        if (typeof mounts === 'string') {
            refuse(source.path, mounts)
            continue
        }
        for (const mount of mounts) {
            const other = mountedBy.get(mount.directory)
            if (other !== undefined) {
                refuse(
                    source.path,
                    `abide: ${other} and ${position} both mount ${mount.specifier}, and a directory answers at one place. RULEBOOK 23.20.`,
                )
                continue
            }
            mountedBy.set(mount.directory, position)
            mounted[relativeTo(root, mount.directory)] = mount.at
            for (const placed of mount.handlers) {
                // Two mounts can overlap, one directory inside the other; a file is placed once.
                if (handled.has(placed.path)) continue
                handled.add(placed.path)
                handlers.push({
                    path: placed.path,
                    relative: relativeTo(root, placed.path),
                    position: placed.position,
                })
            }
            for (const { path, position: placed } of mount.files) {
                // A file a component import reached first takes its mount's position all the same.
                const known = byPath.get(path)
                if (known !== undefined) {
                    known.position = placed
                    continue
                }
                await add({ path, position: placed })
            }
        }
        for (const target of abideImportsOf(
            source.path,
            source.file,
            resolve,
        ).values()) {
            if (!byPath.has(target)) await add({ path: target })
        }
    }
    return { sources: all, handlers, mounted }
}

/**
 * The `Compilation` alone out of `app`, which is what is written to disk and served: the rest of a
 * compiled app is the commands' to read.
 */
export function compilationOf(app: CompiledApp): Compilation {
    return {
        files: app.files,
        handlers: app.handlers,
        tables: app.tables,
        mounted: app.mounted,
    }
}

/**
 * Compiles every `.abide` source and handler of the app at `appRoot` (`Compilation`).
 *
 * `kept` is a checker the caller holds across compiles and closes itself.
 */
export async function compileApp(
    appRoot: string,
    kept?: AppChecker,
): Promise<CompiledApp> {
    const root = realpathSync(appRoot)
    // ONE WALK for the sources, the handler files and the public files, refusing a tree 23.16-23.18
    // forbids before anything is read.
    const { abide, handlers, modules, published } = appFiles(root)
    refuseModuleHooks(root, modules)
    const sources = await sourcesAt(root, abide)
    // 16.2 — an app of handler files alone is still an app.
    if (sources.length === 0 && handlers.length === 0)
        return {
            files: {},
            tables: {},
            handlers: {},
            mounted: {},
            routes: [],
            mounts: [],
            sources: 0,
            warnings: [],
            published,
        }

    // One session for the whole build: opening it spawns the checker, and the cost is paid once
    // rather than per file.
    return withChecker(root, kept, async (session) => {
        // A BUILD STOPS AT THE FIRST REFUSAL, so neither step is handed a list to report it in.
        const own = parseSources(sources)
        const resolve = resolverIn()
        const {
            sources: parsed,
            handlers: handlerFiles,
            mounted,
        } = await withDependencies(root, own, handlers, resolve)
        const { read, warnings } = await readSources(session, parsed)
        const { ambient, unkeyed } = await session.lints(root, parsed)
        // 11.37 — a build error, every read named, rather than a first one and a second run.
        if (ambient.length > 0) {
            const lines: string[] = []
            for (const read of ambient)
                lines.push(formatDiagnosis(read, process.cwd()))
            throw new Error(lines.join('\n'))
        }
        const emitted = await emitApp(
            root,
            session,
            read,
            resolve,
            handlerFiles,
        )
        return {
            ...emitted,
            mounted,
            published,
            sources: sources.length,
            // 11.30 — warned on, and the build goes on.
            warnings: [...warnings, ...unkeyed, ...emitted.warnings],
        }
    })
}

/**
 * The emit half of `compileApp`, over sources already parsed and read.
 *
 * `abide check` has done both by then, file by file, and asks this for only what the whole app can
 * refuse: two handlers at one address, or a template the emit cannot lower.
 */
export async function emitApp(
    root: string,
    session: TypeSession,
    sources: readonly ReadSource[],
    /** The resolver the sources' dependencies were found with, whose answers it keeps. */
    resolve: (specifier: string, from: string) => string | undefined,
    /** The handler files, the app's own and each mounted one (`withDependencies`). */
    handlerFiles: readonly HandlerFile[],
    /** Told of each refusal at its file; the build's throws the first. */
    refuse: Refuse = THROW,
): Promise<
    Pick<
        CompiledApp,
        'files' | 'tables' | 'handlers' | 'routes' | 'mounts' | 'warnings'
    >
> {
    const files: Record<string, CompiledFile> = {}
    const tables: Record<string, string> = {}
    const routes: AppRoute[] = []
    // 32.17 AND 34.14 — WHICH FILES ARE INVOKED AS COMPONENTS, and where each import lands. A
    // caller's client module imports its child's, so a child with nothing to hydrate still
    // needs one to exist (`emitClient`'s no-op), and an invoked file carries its own markup
    // (`emitClient`). Built before the emit loop because a page may invoke a component the
    // walk reaches later.
    const graph = appGraph(root, sources, resolve)
    const parsed = graph.nodes

    // 35.1, 35.12 — every `layout.abide` by the route it covers, one to a route; 35.13 — and one
    // with no template wraps nothing, being the route's hooks alone.
    const layouts: AppLayout[] = []
    const layoutAt = new Map<string, string>()
    const errorAt = new Map<string, string>()
    for (const entry of parsed) {
        if (entry.kind !== 'layout' && entry.kind !== 'error') continue
        const route = routeOf(entry.position)
        const held = entry.kind === 'layout' ? layoutAt : errorAt
        const other = held.get(shapeOf(route))
        if (other !== undefined) {
            refuse(
                entry.relative,
                new Error(
                    `abide: ${other} and ${entry.relative} are both the ${entry.kind}.abide at ${route}. RULEBOOK 35.12.`,
                ),
            )
            continue
        }
        held.set(shapeOf(route), entry.relative)
        if (entry.kind === 'layout' && entry.file.template.length > 0)
            layouts.push({
                source: entry.relative,
                segments: parseRoutePattern(route),
            })
    }
    // 35.2 — every `error.abide`, with the route it answers for and the layouts around it.
    const errors: AppRoute[] = []
    for (const entry of parsed) {
        if (entry.kind !== 'page' && entry.kind !== 'error') continue
        // 23.3, 35.14 — a page or an `error.abide` with nothing to paint is its route's hooks
        // alone.
        if (!paints(entry.file)) continue
        ;(entry.kind === 'page' ? routes : errors).push({
            pattern: entry.route as string,
            source: entry.relative,
            layouts: layoutsAround(entry.route as string, layouts),
        })
    }

    // 16.2 AND 16.28 — THE HANDLERS, read before a module is emitted: the server mounts each one,
    // and the browser holds its wrapper in its place — a handler file's as that file, a private
    // handler's in the server block's place in its own file's module. Written whether or not there
    // is a page: a handler is answered over http to a caller that has none.
    const { mounts, warnings } = await handlersUnder(
        session,
        parsed,
        handlerFiles,
        refuse,
    )
    refuseSharedRoutes(routes, mounts, refuse)
    refuseStrayLauncher(parsed, handlerFiles, refuse)
    const standIns = standInsOf(mounts)
    // 37.1 — every module a server block or a handler file runs in, for the boot to import before
    // `onStart`.
    const servers: string[] = []
    for (const file of handlerFiles) servers.push(file.relative)
    let transitions = false
    for (const entry of parsed) {
        // 35.16 — of the files with an address, the root layout alone is outermost in every render.
        if (
            entry.file.document !== undefined &&
            entry.kind !== 'component' &&
            !(entry.kind === 'layout' && routeOf(entry.position) === '/')
        ) {
            refuse(
                entry.relative,
                new Error(
                    `abide: ${entry.relative} writes <html>, and of the pages, layouts and error pages only the root layout.abide writes the document. RULEBOOK 35.16.`,
                ),
            )
            continue
        }
        const emitted = emitSource(
            entry.relative,
            entry.file,
            entry.answer,
            graph.invoked.has(entry.path),
            standIns.get(entry.relative),
            entry.text,
            entry.position,
        )
        if (entry.file.servers.length > 0) servers.push(entry.relative)
        transitions ||= emitted.transitions
        // 34.26 — a dependency's module runs on the app's runtime, whatever the package carries.
        const onAppRuntime =
            placeOf(entry.relative) === 'dependency'
                ? (text: string) => onAbideOf(root, entry.path, text)
                : (text: string) => text
        files[entry.relative] = {
            server: onAppRuntime(emitted.server),
            client: onAppRuntime(emitted.client),
            sheet: emitted.sheet,
            // A map placing nothing — a file of markup alone — is left out.
            serverMappings: placing(emitted.serverMappings),
            clientMappings: placing(emitted.clientMappings),
        }
    }
    // THE ROUTE TABLE, as the build's own knowledge rather than a list an app maintains. Which
    // addresses exist is a fact about the file tree (a page is an address, 23.3),
    // so a route that is not a file cannot be written and a file that is one cannot be
    // forgotten. The loaders are dynamic imports, which is what keeps a destination's
    // markup and bindings off the entry page's bundle until somebody navigates there.
    //
    // TWO TABLES OFF ONE WALK, each importing a file's `?component` face — the same addresses
    // either way, which is what keeps the pair from being two walks that can disagree. The
    // server's is written with no
    // page too — an app of handlers alone still answers — and the client's, with the entry
    // that boots it, only where there is a page to boot.
    tables[SERVER_TABLE] = serverTable(routes, errors, servers, mounts)
    // 16.74 — what the browser holds of each handler file, and the route its hooks are filed at:
    // read by the module's load, which runs before the server table is imported.
    const handlers: Compilation['handlers'] = {}
    for (const mount of mounts)
        if (!mount.private)
            handlers[mount.source] = {
                scope: mount.scope,
                client: standIns.get(mount.source) ?? '',
            }
    if (routes.length > 0) {
        tables[ROUTES_TABLE] = clientTable(routes, transitions)
        // The entry's SOURCE carries the name the bundle is written under — `entry-<hash>.js`
        // from a build and `entry.js` in dev — and its key in the manifest (38.22, 38.5).
        tables[`${CLIENT_ENTRY}.ts`] = ENTRY_MODULE
    }
    return {
        files,
        tables,
        handlers,
        routes,
        mounts,
        warnings,
    }
}

/**
 * `text`, a module compiled from the dependency's `.abide` at `path`, with each of abide's own
 * specifiers written as the path to the file the app's root resolves it to.
 *
 * 34.26 — RELATIVE, so the compilation still serves once the app and its `node_modules` are moved
 * together, and THE FILE the app's own code loads, so the two are one module instance. A path and
 * not a specifier a plugin answers: bun's runtime hands a plugin no bare specifier that names no
 * file, so a mark on `@abide/abide/server` was never read.
 */
function onAbideOf(root: string, path: string, text: string): string {
    const from = dirname(realpathSync(path))
    return respecified(text, (specifier) => {
        if (!isAbideSpecifier(specifier)) return undefined
        let target: string
        try {
            target = resolvedFile(specifier, root)
        } catch {
            return undefined
        }
        const relativePath = posix.relative(from, target)
        return relativePath.startsWith('.') ? relativePath : `./${relativePath}`
    })
}

// `mappings` that place something, or `undefined` for a module of markup alone.
function placing(mappings: string | undefined): string | undefined {
    return mappings !== undefined && /[^;]/.test(mappings)
        ? mappings
        : undefined
}

/**
 * How a table imports the `.abide` at `source`: from `__abide`, one directory below the root, as
 * the module the file compiles to.
 */
function tableImport(source: string): string {
    return JSON.stringify(
        source.endsWith('.abide')
            ? `../${source}${COMPONENT_QUERY}`
            : `../${source}`,
    )
}

// A layout and the route it covers, parsed.
type AppLayout = { source: string; segments: Segment[] }

/**
 * The layouts a page renders inside, outermost first.
 *
 * 35.1 — every `layout.abide` whose route lies ON THE WAY DOWN to the page's wraps it and no other
 * does: `src/layout.abide` wraps the page `src/media/index.abide` serves at `/media`, and so does
 * `src/[section]/layout.abide`. So the test is a prefix of the route, kind by kind, and the nesting
 * order is the route's depth.
 */
function layoutsAround(route: string, layouts: AppLayout[]): string[] {
    const page = parseRoutePattern(route)
    const chain: AppLayout[] = []
    for (const layout of layouts)
        if (coversRoute(layout.segments, page)) chain.push(layout)
    // A shorter route is an outer one: they are prefixes of each other by construction.
    chain.sort((one, two) => one.segments.length - two.segments.length)
    const sources: string[] = []
    for (const layout of chain) sources.push(layout.source)
    return sources
}

/**
 * A route with its parameters' names erased: what two routes answering one address share.
 *
 * 19.1 — `/media/[id]` and `/media/[slug]` are one route.
 */
function shapeOf(route: string): string {
    let shape = ''
    for (const segment of parseRoutePattern(route))
        shape += `/${segment.kind === 'static' ? segment.name : `[${segment.kind}]`}`
    return shape === '' ? '/' : shape
}

/**
 * Refuses, naming both, where two files answer one method at one route — at the second.
 *
 * 19.1 — a page answers `GET` at its own, and a handler its method at its address.
 */
function refuseSharedRoutes(
    routes: AppRoute[],
    mounts: Mount[],
    refuse: Refuse,
): void {
    const owners = new Map<string, string>()
    const claim = (method: string, route: string, source: string): void => {
        const key = `${method} ${shapeOf(route)}`
        const owner = owners.get(key)
        if (owner === undefined) owners.set(key, source)
        else
            refuse(
                source,
                new Error(
                    `abide: ${owner} and ${source} both answer ${method} at ${route}. RULEBOOK 19.1.`,
                ),
            )
    }
    for (const route of routes) claim('GET', route.pattern, route.source)
    for (const mount of mounts) claim(mount.method, mount.address, mount.source)
}

/**
 * Refuses, naming the file, where anything but the root's `launcher.abide` calls `onLauncher`.
 *
 * 38.107 — the launch loads that file alone, so a call anywhere else is never read.
 */
function refuseStrayLauncher(
    sources: readonly { relative: string; position: string; file: AbideFile }[],
    handlerFiles: readonly HandlerFile[],
    refuse: Refuse,
): void {
    const stray = (relative: string): void =>
        refuse(
            relative,
            new Error(
                `abide: ${relative} calls onLauncher, which is read from src/${LAUNCHER_PAGE} alone. Move the call there. RULEBOOK 38.107.`,
            ),
        )
    for (const source of sources)
        if (
            source.position !== LAUNCHER_PAGE &&
            source.file.servers.some(callsLauncher)
        )
            stray(source.relative)
    for (const file of handlerFiles)
        if (callsLauncher(readFileSync(file.path, 'utf8'))) stray(file.relative)
}

/**
 * 37.13 — a hook called in a module that is neither a `.abide` nor a handler file runs as the module
 * is imported, before any file's route is set, and not at all where nothing imports it. A hook is a
 * name the module imports from abide, or a member of a namespace it does, so `emitter.onError(…)` in
 * a module that imports abide for `reactive` is no hook.
 */
export function refuseModuleHooks(
    root: string,
    modules: readonly string[],
    refuse: Refuse = THROW,
): void {
    for (const module of modules) {
        const source = readFileSync(`${root}/${module}`, 'utf8')
        if (!source.includes(SHARED_SPECIFIER)) continue
        const imported = new Set<string>()
        for (const statement of importStatements(source))
            if (isAbideSpecifier(statement.specifier))
                for (const binding of statement.bindings)
                    if (!binding.typeOnly) imported.add(binding.imported)
        const hook = hooksCalled(source).find(
            (name) => imported.has(name) || imported.has('*'),
        )
        if (hook !== undefined)
            refuse(
                module,
                new Error(
                    `abide: ${module} calls ${hook}, and it is neither a .abide nor a handler file, so the call has no route. Export what it is handed and call ${hook} in the page, layout or handler file it serves. RULEBOOK 37.13.`,
                ),
            )
    }
}

/** `@abide/abide` or one of its subpaths. */
function isAbideSpecifier(specifier: string): boolean {
    return (
        specifier === SHARED_SPECIFIER ||
        specifier.startsWith(`${SHARED_SPECIFIER}/`)
    )
}

function callsLauncher(source: string): boolean {
    return (
        source.includes('onLauncher') &&
        hooksCalled(source).includes('onLauncher')
    )
}

/**
 * Resolves a specifier from a directory as bun does, or `undefined` where it does not resolve.
 *
 * A COMPONENT IMPORT RESOLVES THE WAY THE APP'S OWN IMPORTS DO — its import map, from the file
 * that wrote it. One that does not resolve is left as written, and the bundle names it. THE
 * ANSWER IS A REAL PATH, as every root handed to the compiler is.
 */
export function resolverIn(): (
    specifier: string,
    from: string,
) => string | undefined {
    // ONE ANSWER PER SPECIFIER AND DIRECTORY for as long as the resolver lives: a compile resolves
    // every import once for its dependencies and again for its graph, and hands both one resolver.
    const answered = new Map<string, string | undefined>()
    return (specifier, from) => {
        const key = `${from}\0${specifier}`
        if (answered.has(key)) return answered.get(key)
        const found = resolveFrom(specifier, from)
        answered.set(key, found)
        return found
    }
}

function resolveFrom(specifier: string, from: string): string | undefined {
    try {
        return resolvedFile(specifier, from)
    } catch {
        // 38.65 — BUN KEEPS A DIRECTORY'S LISTING FOR THE LIFE OF THE PROCESS, and looks a `#` specifier up
        // in it with no second look — where a relative one that misses reads the directory again.
        // `abide dev` compiles in one process for its whole session, so a component created since
        // its directory was listed never resolved, and was read as uninvoked. The `imports` map is
        // read here instead, and the file it names looked for on disk.
        return specifier.startsWith('#')
            ? throughImports(specifier, from)
            : undefined
    }
}

/** A `#` specifier resolved through the nearest `package.json`'s `imports`, to a file that exists. */
function throughImports(specifier: string, from: string): string | undefined {
    const manifest = nearest(from, 'package.json')
    if (manifest === undefined) return undefined
    const imports = (
        JSON.parse(readFileSync(manifest, 'utf8')) as {
            imports?: Record<string, unknown>
        }
    ).imports
    if (imports === undefined) return undefined
    const base = dirname(manifest)
    for (const [key, targets] of Object.entries(imports)) {
        const star = key.indexOf('*')
        let matched: string | undefined
        if (star === -1) matched = key === specifier ? '' : undefined
        else if (
            specifier.startsWith(key.slice(0, star)) &&
            specifier.endsWith(key.slice(star + 1)) &&
            specifier.length >= key.length - 1
        )
            matched = specifier.slice(
                star,
                specifier.length - (key.length - star - 1),
            )
        if (matched === undefined) continue
        // A conditions object names no path of its own, and is passed over.
        for (const target of [targets].flat()) {
            if (typeof target !== 'string') continue
            const path = posix.join(base, target.replace('*', matched))
            if (existsSync(path)) return path
        }
    }
    return undefined
}

/** The rows of either route table, one per route, `column` appending the fields only one carries. */
function tableOf(
    routes: AppRoute[],
    column: (route: AppRoute) => string = () => '',
): string {
    const rows: string[] = []
    for (const route of routes) {
        // 35.1 — THE CHAIN IS PART OF THE ADDRESS, so it is in the table rather than resolved at
        // run time: which layouts wrap a page is a fact about the file tree, and the server and
        // the client read it off the same walk for the reason the addresses are (30.8).
        const wrapping = route.layouts.map(
            (layout) => `() => import(${tableImport(layout)})`,
        )
        rows.push(
            `    { pattern: ${JSON.stringify(route.pattern)}, load: () => import(${tableImport(route.source)}), layouts: [${wrapping.join(', ')}]${column(route)} },`,
        )
    }
    return rows.join('\n')
}

/**
 * The source of `routes.ts`, the client's route table and the `start` that boots its router.
 *
 * `host: Element` IS NOT DECORATION. This is a `.ts` file an app bundles, so an app whose own
 * tsconfig includes its build output typechecks it — and a bare `host` is an implicit `any` that
 * fails `tsc` under the `strict` every abide app is written against.
 */
function clientTable(routes: AppRoute[], transitions: boolean): string {
    return `// Written by \`abide build\`. The addresses this app answers, and what to load for each.
import { listenForRoutes, startRouter } from '${ROUTING_SPECIFIER}'

export const routes = [
${tableOf(routes)}
]

// The router this document gets, the page it arrived on, and the two places a reader navigates
// from (30.7). Hydrating here rather than leaving it to the app is what makes the page the server
// painted live without anybody wiring it.
export function start(host: Element) {
    const router = startRouter(routes, host, ${transitions})
    listenForRoutes(router)
    const ready = router.hydrate()
    return { router, ready }
}
`
}

/**
 * The source of `server.ts`: the same addresses, loading the module that PAINTS each page, the
 * error pages, the modules a server block runs in, and every handler.
 *
 * No `start` here and nothing imported: the server holds the matching and the ranking already,
 * and a server table that carried either would be a second copy of both.
 */
function serverTable(
    routes: AppRoute[],
    errors: AppRoute[],
    servers: string[],
    mounts: Mount[],
): string {
    let loaders = ''
    for (const source of servers)
        loaders += `    () => import(${tableImport(source)}),\n`
    let handlers = ''
    for (const mount of mounts) {
        const fields = JSON.stringify(mount)
        // The module the handler is declared in — the handler file, or the `.abide`'s server
        // module, the route table's own.
        handlers += `    { load: () => import(${tableImport(mount.source)}), ${fields.slice(1, -1)} },\n`
    }
    return `// Written by \`abide build\`. The addresses this app answers, and what paints each.
export const routes = [
${tableOf(routes, clientModules)}
]

// 35.2 — the error pages, by the directory each answers for.
export const errors = [
${tableOf(errors)}
]

// 37.1 — every module a \`<script server>\` runs in, imported before the app boots.
export const servers = [
${loaders}]

// 16.2 — every handler this app answers over http, and where each is.
export const handlers = [
${handlers}]
`
}

/**
 * The server row's `clientModules` column: what the browser will load at this address.
 *
 * 38.28 — named on the SERVER's row: the server writes the document, and the preloads for the page
 * and its chain have to be in it before the client has run at all. Keys into the manifest
 * `manifestOf` reads off the bundle.
 */
function clientModules(route: AppRoute): string {
    return `, clientModules: ${JSON.stringify([route.source, ...route.layouts])}`
}

/**
 * The wrappers the browser holds in each handler's place, by source.
 *
 * 16.28 — WHAT A BROWSER HOLDS WHERE THE APP WROTE A PRIVATE HANDLER: the same name, the same call
 * over the wire, bound in its `.abide`'s server block's place. 16.74 — a handler file's is its own
 * module, its default, answered in the file's place.
 */
function standInsOf(mounts: Mount[]): Map<string, string> {
    const lines = new Map<string, string[]>()
    for (const mount of mounts) {
        // 20.4 — withheld from the browser: no wrapper, so a call of it there names nothing.
        if (!mount.ui) continue
        const held = lines.get(mount.source) ?? []
        held.push(
            wireLine(
                mount,
                mount.private ? `const ${mount.name} =` : 'export default',
            ),
        )
        lines.set(mount.source, held)
    }
    const standIns = new Map<string, string>()
    for (const [source, held] of lines) standIns.set(source, wireModule(held))
    return standIns
}

/**
 * One handler's wrapper, bound as `binding` writes it.
 *
 * The address is written RELATIVE to the bundle's own directory and resolved against the chunk at
 * run time (16.10), so an app mounted under a sub-path calls its own handlers rather than the
 * root's.
 */
function wireLine(mount: Mount, binding: string): string {
    const at = JSON.stringify(posix.relative(CLIENT_ADDRESS, mount.address))
    // 18.4 — what the handler's value declares that the browser's copy behaves by.
    // 11.29 — and the defaults its parameter writes, which the copy keys by.
    const copy =
        mount.defaults !== undefined
            ? `, ${JSON.stringify(mount.copy)}, ${JSON.stringify(mount.defaults)}`
            : mount.copy === undefined
              ? ''
              : `, ${JSON.stringify(mount.copy)}`
    return `${binding} __wire(${JSON.stringify(mount.method)}, new URL(${at}, import.meta.url).pathname${copy})\n`
}

/** A module of wrappers: the import they share, then each line. */
function wireModule(lines: string[]): string {
    return `// 16.28 — what a browser holds in place of a handler.
import { wire as __wire } from '${WIRE_SPECIFIER}'
${lines.join('')}`
}

/** Whether a page or an error page has anything to paint: a template, or a head. 23.3, 35.14. */
export function paints(file: AbideFile): boolean {
    return file.template.length > 0 || file.head.length > 0
}

// THE ENTRY. An app does not write it: which module boots the client is the build's knowledge,
// exactly as the route table is, and a hand-written entry is one more file to keep in step with a
// layout that moves.
const ENTRY_MODULE = `// Written by \`abide build\`. What boots this app in a browser.
import { start } from '../${VIRTUAL_DIRECTORY}/${ROUTES_TABLE}'

start(document.body)
`
