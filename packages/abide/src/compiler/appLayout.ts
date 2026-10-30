import { relative as relativeTo } from 'node:path' // bun exposes no path helpers of its own
import { appFiles } from '#server/appTree.ts'
import { type Placement, placement, routeOf } from '#server/placement.ts'
import {
    HEALTH_ADDRESS,
    MCP_ADDRESS,
    OPENAPI_ADDRESS,
    PRINCIPAL_ADDRESS,
} from '#shared/ADDRESSES.ts'
import { LAUNCHER_PAGE } from '#shared/LAUNCHER_FILES.ts'
import {
    coversRoute,
    parseRoutePattern,
    type Segment,
} from '#shared/routePattern.ts'
import { abideImportsOf, componentGraph } from './componentGraph.ts'
import type { HandlerFile } from './handlersUnder.ts'
import { hookCalls, hooksIn } from './hookCalls.ts'
import { mountsOf } from './mountsOf.ts'
import { type AbideFile, scriptBodies } from './parseAbide.ts'
import { Refusals } from './Refusals.ts'
import { type ParsedSource, parseSources } from './readSources.ts'
import { resolverIn } from './resolverIn.ts'
import { attributedImports } from './splitImports.ts'
import type { Diagnosis } from './TypeSession.ts'

// THE APP, LAID OUT ONCE PER COMPILE OR CHECK: every `.abide` and handler file it holds — its own, a
// dependency's it imports, a package's it mounts — each with where it sits and what that makes it
// (`placement`), the route table and the layouts around each route, and what the tree refuses. Every
// reader takes its answer from here rather than asking a path again, so the build's routes, the
// checker's `Routes`, `abide routes` and the browser's fence cannot disagree about one file.

/** One `.abide` in the app, parsed and placed. */
export type PlacedSource = ParsedSource &
    Placement & {
        /** 23.3, 35.14 — a template or a head: a page or an error page that does not is its hooks alone. */
        paints: boolean
        /** 32.17 — another file imports it, so it carries its own markup. */
        invoked: boolean
        /** 37.1 — each of abide's hooks its scripts call, in the order written (`hookCalls`). */
        hooks: string[]
    }

/** One handler file in the app, read and placed. */
export type PlacedHandler = HandlerFile & {
    /** 23.14 — the address its default answers at. */
    route: string
    /** 37.1 — the route its hooks are filed at. */
    scope: string
    text: string
    hooks: string[]
}

/** A page or an error page and the layouts it renders inside. */
export type AppRoute = {
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

/** The app at a root, laid out (`appLayout`). */
export type AppLayout = {
    /** Real, as bun resolves every import. */
    root: string
    /** Every `.abide` — the app's own first, in path order, then each one they reach. */
    sources: PlacedSource[]
    /** How many of `sources` are the app's own, which is what the commands report. */
    own: number
    /** The handler files, the app's own and each mounted one, at the position each answers by. */
    handlers: PlacedHandler[]
    /** 23.3 — the painting pages, each with the layouts around it. */
    routes: AppRoute[]
    /** 35.2 — the painting error pages, each with the layouts around it. */
    errors: AppRoute[]
    /** Every public file's source path to its address. 36.11. */
    published: Map<string, string>
    /** 30.26 — every address a link may name: a page's, a public file's, and 21.4's four. */
    addresses: string[]
    /** What the tree refuses, each at its file; a build stops naming every one. */
    refused: Diagnosis[]
    /**
     * What the parser refuses of each `.abide` as the disk holds it, each at its file. Apart from
     * `refused` because it is the TEXT's: an editor's check parses the text it holds instead (38.34).
     */
    unparsed: Diagnosis[]
    /** The resolver every import was followed with, whose answers it keeps. */
    resolve: (specifier: string, from: string) => string | undefined
}

/**
 * The app at `root` — real — laid out, every refusal collected at its file (`refused`).
 *
 * ONE WALK (`appFiles`), then each `.abide` parsed and followed through its component imports and its
 * mounts (`withDependencies`), then each placed. A missing root is an app with nothing in it.
 */
export async function appLayout(root: string): Promise<AppLayout> {
    // COLLECTED, whoever asks: a layout is kept across checks (`AppChecker`), and a build adopts
    // what it found (`Refusals.adopt`).
    const refusals = new Refusals(root, true)
    const { abide, handlers, modules, published } = appFiles(root, refusals)
    await refuseModuleHooks(root, modules, refusals)
    const resolve = resolverIn()
    const unparsed = new Refusals(root, true)
    const own = parseSources(
        await textsAt(abide.map((path) => `${root}/${path}`)),
        unparsed,
    )
    const found = await withDependencies(
        root,
        own,
        handlers,
        resolve,
        refusals,
        unparsed,
    )
    const invoked = componentGraph(found.sources, resolve).invoked
    const sources: PlacedSource[] = []
    for (const source of found.sources) {
        const relative = relativeTo(root, source.path)
        const placed = placement(
            relative,
            found.positions.get(source.path) ?? relative,
        )
        refusePlace(source, placed, resolve, refusals)
        sources.push({
            ...source,
            ...placed,
            paints: paints(source.file),
            invoked: invoked.has(source.path),
            hooks: hooksIn(scriptBodies(source.file)),
        })
    }
    const texts = await textsAt(found.handlers.map((file) => file.path))
    const placedHandlers: PlacedHandler[] = []
    for (let at = 0; at < found.handlers.length; at += 1) {
        const file = found.handlers[at] as HandlerFile
        const { text } = texts[at] as { text: string }
        placedHandlers.push({
            ...file,
            route: routeOf(file.position),
            scope: placement(file.relative, file.position).scope,
            text,
            hooks: hooksIn([text]),
        })
    }
    refuseStrayLauncher(sources, placedHandlers, refusals)
    const { routes, errors } = routesOf(sources, refusals)
    const addresses = new Set<string>()
    for (const route of routes) addresses.add(route.pattern)
    for (const address of published.values()) addresses.add(address)
    for (const address of FETCHED_ADDRESSES) addresses.add(address)
    return {
        root,
        sources,
        own: own.length,
        handlers: placedHandlers,
        routes,
        errors,
        published,
        addresses: [...addresses].sort(),
        refused: refusals.found,
        unparsed: unparsed.found,
        resolve,
    }
}

// 30.26, 21.4 — the framework's own addresses an app fetches, which every app answers at.
const FETCHED_ADDRESSES = [
    OPENAPI_ADDRESS,
    MCP_ADDRESS,
    HEALTH_ADDRESS,
    PRINCIPAL_ADDRESS,
]

/** The file at each of `paths`, read. The reads overlap. */
function textsAt(
    paths: readonly string[],
): Promise<{ path: string; text: string }[]> {
    return Promise.all(
        paths.map(async (path) => ({
            path,
            text: await Bun.file(path).text(),
        })),
    )
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
    refusals: Refusals,
    /** Where what the parser refuses of a file reached here goes, where apart from `refusals`. */
    unparsed: Refusals = refusals,
): Promise<{
    sources: ParsedSource[]
    handlers: HandlerFile[]
    /** 23.19 — each mounted `.abide`'s position, by its path; one at its own path is not here. */
    positions: Map<string, string>
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
    const byPath = new Map<string, ParsedSource>()
    for (const source of all) byPath.set(source.path, source)
    const positions = new Map<string, string>()
    // 23.20 — a directory mounts once, and by whom.
    const mountedBy = new Map<string, string>()
    const add = async (path: string): Promise<void> => {
        let text: string
        try {
            text = await Bun.file(path).text()
        } catch (thrown) {
            // 38.65 — bun keeps a directory's listing for the process's life, so an import of a file
            // deleted since still resolves; like a specifier that does not, it invokes nothing.
            if ((thrown as { code?: unknown }).code === 'ENOENT') return
            throw thrown
        }
        for (const one of parseSources([{ path, text }], unparsed)) {
            byPath.set(one.path, one)
            all.push(one)
        }
    }
    for (let at = 0; at < all.length; at += 1) {
        const source = all[at] as ParsedSource
        const position =
            positions.get(source.path) ?? relativeTo(root, source.path)
        for (const mount of mountsOf(
            root,
            source.path,
            position,
            source.file,
            refusals,
        )) {
            const other = mountedBy.get(mount.directory)
            if (other !== undefined) {
                refusals.at(
                    source.path,
                    new Error(
                        `abide: ${other} and ${position} both mount ${mount.specifier}, and a directory answers at one place. RULEBOOK 23.20.`,
                    ),
                )
                continue
            }
            mountedBy.set(mount.directory, position)
            trees.push({
                directory: mount.directory,
                at: mount.at,
                params: mount.params,
            })
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
                positions.set(path, placed)
                if (!byPath.has(path)) await add(path)
            }
        }
        for (const target of abideImportsOf(
            source.path,
            source.file,
            resolve,
        ).values()) {
            if (!byPath.has(target)) await add(target)
        }
    }
    return { sources: all, handlers, positions, trees }
}

/** Whether a page or an error page has anything to paint: a template, or a head. 23.3, 35.14. */
export function paints(file: AbideFile): boolean {
    return file.template.length > 0 || file.head.length > 0
}

/**
 * Refuses what a source's place forbids it.
 *
 * 34.20 — a server block under a `public` directory, which holds no component that runs. 34.21 — a file imported as text that is not there, found at build rather than when its
 * module first loads. 35.16 — of the files with an address, the root layout alone writes the
 * document.
 */
function refusePlace(
    source: ParsedSource,
    placed: Placement,
    resolve: (specifier: string, from: string) => string | undefined,
    refusals: Refusals,
): void {
    const { relative, place, kind } = placed
    if (source.file.servers.length > 0 && place === 'public')
        refusals.at(
            relative,
            new Error(
                `abide: ${relative} has a <script server>, and it is under a public directory, where nothing has an address. Move the file out of it, or the code into a server file under a lib directory. RULEBOOK 34.20.`,
            ),
        )
    const from = source.path.slice(0, source.path.lastIndexOf('/'))
    for (const script of scriptBodies(source.file))
        for (const { specifier } of attributedImports(script, 'text'))
            if (resolve(specifier, from) === undefined)
                refusals.at(
                    relative,
                    new Error(
                        `abide: ${relative} imports ${specifier} as text, and there is no such file. RULEBOOK 34.21.`,
                    ),
                )
    if (
        source.file.document !== undefined &&
        kind !== 'component' &&
        !(kind === 'layout' && placed.route === '/')
    )
        refusals.at(
            relative,
            new Error(
                `abide: ${relative} writes <html>, and of the pages, layouts and error pages only the root layout.abide writes the document. RULEBOOK 35.16.`,
            ),
        )
}

/**
 * Refuses, naming the module, every module under a `lib` directory that calls a hook.
 *
 * 37.13 — a hook called in a module that is neither a `.abide` nor a handler file runs as the module
 * is imported, before any file's route is set, and not at all where nothing imports it.
 */
async function refuseModuleHooks(
    root: string,
    modules: readonly string[],
    refusals: Refusals,
): Promise<void> {
    const texts = await textsAt(modules.map((module) => `${root}/${module}`))
    for (let at = 0; at < modules.length; at += 1) {
        const module = modules[at] as string
        const hook = hookCalls((texts[at] as { text: string }).text)[0]?.hook
        if (hook !== undefined)
            refusals.at(
                module,
                new Error(
                    `abide: ${module} calls ${hook}, and it is neither a .abide nor a handler file, so the call has no route. Export what it is handed and call ${hook} in the page, layout or handler file it serves. RULEBOOK 37.13.`,
                ),
            )
    }
}

/**
 * Refuses, naming the file, where anything but the root's `launcher.abide` calls `onLauncher`.
 *
 * 38.107 — the launch loads that file alone, so a call anywhere else is never read.
 */
function refuseStrayLauncher(
    sources: readonly PlacedSource[],
    handlers: readonly PlacedHandler[],
    refusals: Refusals,
): void {
    const stray = (relative: string): void =>
        refusals.at(
            relative,
            new Error(
                `abide: ${relative} calls onLauncher, which is read from src/${LAUNCHER_PAGE} alone. Move the call there. RULEBOOK 38.107.`,
            ),
        )
    for (const source of sources)
        if (
            source.position !== LAUNCHER_PAGE &&
            source.hooks.includes('onLauncher')
        )
            stray(source.relative)
    for (const file of handlers)
        if (file.hooks.includes('onLauncher')) stray(file.relative)
}

/**
 * The painting pages and error pages, each with the layouts around it, refusing two layouts or two
 * error pages at one route.
 *
 * 35.1, 35.12 — every `layout.abide` by the route it covers, one to a route; 35.13 — and one with no
 * template wraps nothing, being the route's hooks alone. 23.3, 35.14 — a page or an `error.abide`
 * with nothing to paint is its route's hooks alone.
 */
function routesOf(
    sources: readonly PlacedSource[],
    refusals: Refusals,
): { routes: AppRoute[]; errors: AppRoute[] } {
    const layouts: { source: string; segments: Segment[] }[] = []
    const layoutAt = new Map<string, string>()
    const errorAt = new Map<string, string>()
    for (const source of sources) {
        if (source.kind !== 'layout' && source.kind !== 'error') continue
        const route = source.route as string
        const held = source.kind === 'layout' ? layoutAt : errorAt
        const other = held.get(shapeOf(route))
        if (other !== undefined) {
            refusals.at(
                source.relative,
                new Error(
                    `abide: ${other} and ${source.relative} are both the ${source.kind}.abide at ${route}. RULEBOOK 35.12.`,
                ),
            )
            continue
        }
        held.set(shapeOf(route), source.relative)
        if (source.kind === 'layout' && source.file.template.length > 0)
            layouts.push({
                source: source.relative,
                segments: parseRoutePattern(route),
            })
    }
    // 35.1 — every `layout.abide` whose route lies ON THE WAY DOWN to the page's wraps it and no
    // other does, so the test is a prefix of the route, kind by kind, and the nesting order is the
    // route's depth: a shorter route is an outer one.
    layouts.sort((one, two) => one.segments.length - two.segments.length)
    const routes: AppRoute[] = []
    const errors: AppRoute[] = []
    for (const source of sources) {
        if (source.kind !== 'page' && source.kind !== 'error') continue
        if (!source.paints) continue
        const pattern = source.route as string
        const page = parseRoutePattern(pattern)
        const around: string[] = []
        for (const layout of layouts)
            if (coversRoute(layout.segments, page)) around.push(layout.source)
        ;(source.kind === 'page' ? routes : errors).push({
            pattern,
            source: source.relative,
            layouts: around,
        })
    }
    return { routes, errors }
}

/**
 * A route with its parameters' names erased: what two routes answering one address share.
 *
 * 19.1 — `/media/[id]` and `/media/[slug]` are one route.
 */
export function shapeOf(route: string): string {
    let shape = ''
    for (const segment of parseRoutePattern(route))
        shape += `/${segment.kind === 'static' ? segment.name : `[${segment.kind}]`}`
    return shape === '' ? '/' : shape
}
