import { realpathSync } from 'node:fs' // bun exposes no sync realpath of its own
import { dirname, posix } from 'node:path' // bun exposes no path helpers of its own
import {
    type Compilation,
    type CompiledFile,
    resolvedFile,
} from '#server/abideModules.ts'
import type { Mount } from '#server/answerRpc.ts'
import { CLIENT_ENTRY } from '#server/CLIENT_BUILD.ts'
import { COMPONENT_QUERY } from '#server/MODULE_QUERIES.ts'
import { ROUTES_TABLE, SERVER_TABLE } from '#server/TABLES.ts'
import { VIRTUAL_DIRECTORY } from '#server/VIRTUAL_DIRECTORY.ts'
import { CLIENT_ADDRESS } from '#shared/ADDRESSES.ts'
import { ROUTING_SPECIFIER, WIRE_SPECIFIER } from '#shared/SPECIFIERS.ts'
import {
    type AppLayout,
    type AppRoute,
    appLayout,
    type PlacedSource,
    shapeOf,
} from './appLayout.ts'
import { emitSource } from './emitSource.ts'
import { handlersUnder } from './handlersUnder.ts'
import { isAbideSpecifier } from './hookCalls.ts'
import { nearest } from './nearest.ts'
import { projectShadow } from './projectShadow.ts'
import { Refusals } from './Refusals.ts'
import { type ReadSource, readSources } from './readSources.ts'
import { respecified } from './splitImports.ts'
import { type Diagnosis, TypeSession } from './TypeSession.ts'
import { writeDefaultProject } from './writeDefaultProject.ts'

// AN APP'S `.abide` SOURCES, COMPILED — every file keyed by its path below the root, and loaded
// there through its `?component` face (`abideModules`). Nothing here touches the output directory:
// `abide build` writes what this hands back and `abide dev` keeps it in memory (38.16), and the two
// commands serving different markup from the same sources is exactly what one compile in two sinks
// makes impossible.

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
     * The app, laid out (`appLayout`) — kept until `saw` hears anything move, so a check asked again
     * and again while an editor types re-reads nothing on disk.
     */
    layout: () => Promise<AppLayout>
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
    let layout: Promise<AppLayout> | undefined
    return {
        session,
        root,
        saw: (path) => {
            layout = undefined
            if (path === undefined) movedSomewhere = true
            else moved.add(path)
        },
        layout: () => {
            layout ??= appLayout(root).catch((thrown: unknown) => {
                layout = undefined
                throw thrown
            })
            return layout
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
async function withChecker<Result>(
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
 * The `Compilation` alone out of `app`, which is what is written to disk and served: the rest of a
 * compiled app is the commands' to read.
 */
export function compilationOf(app: CompiledApp): Compilation {
    return {
        files: app.files,
        handlers: app.handlers,
        tables: app.tables,
    }
}

/**
 * Compiles every `.abide` source and handler of the app at `appRoot` (`Compilation`), stopping at
 * the first thing it refuses.
 *
 * `kept` is a checker the caller holds across compiles and closes itself.
 */
export async function compileApp(
    appRoot: string,
    kept?: AppChecker,
): Promise<CompiledApp> {
    return (await compiled(appRoot, kept, false)).app
}

/**
 * The app at `appRoot` compiled — THE ONE PIPELINE `abide build` and `abide check` both run, the
 * layout, the reads, the lints and the emit, differing only in what a refusal does (`Refusals`) and
 * in what is checked beside: a build stops at the first refusal, and a check (`checking`) reports
 * every one at its file with what the checker says of each file (38.3), and goes on checking
 * whatever a refusal does not stop (38.33).
 */
export async function compiled(
    appRoot: string,
    kept: AppChecker | undefined,
    checking: boolean,
): Promise<{ app: CompiledApp; findings: Diagnosis[] }> {
    const root = realpathSync(appRoot)
    const refusals = new Refusals(root, checking)
    // ONE LAYOUT for the sources, the handler files and the public files, and what the tree refuses
    // is met before the checker is asked anything.
    const layout = await (kept?.layout() ?? appLayout(root))
    refusals.adopt([...layout.unparsed, ...layout.refused])
    const app: CompiledApp = {
        files: {},
        tables: {},
        handlers: {},
        routes: [],
        mounts: [],
        sources: layout.own,
        warnings: [],
        published: layout.published,
    }
    // 16.2 — an app of handler files alone is still an app; one of neither has nothing to build, and
    // a check still has its `.ts` to check.
    if (
        !checking &&
        layout.sources.length === 0 &&
        layout.handlers.length === 0
    )
        return { app, findings: [] }

    // One session for the whole compile: opening it spawns the checker, and the cost is paid once
    // rather than per file.
    return withChecker(root, kept, async (session) => {
        // 38.33 — A FILE WHOSE PROJECTION IS REFUSED (34.3, 34.17) is refused at its file, found here
        // because every later step projects it and would refuse it for the whole app.
        const projected: PlacedSource[] = []
        for (const source of layout.sources)
            try {
                projectShadow(source.file)
                projected.push(source)
            } catch (thrown) {
                refusals.at(source.path, thrown)
            }
        const { read, warnings } = await readSources(
            session,
            projected,
            refusals,
        )
        let found: Diagnosis[] = []
        let emittable = read
        if (checking) {
            // THE APP'S OWN FILES ARE REPORTED ON: a dependency's is compiled with them (34.23), and
            // what is wrong inside a package is the package's to report.
            const reported: typeof read = []
            for (const source of read)
                if (!source.dependency) reported.push(source)
            const diagnosed = await session.diagnose(reported, layout)
            found = diagnosed.diagnoses
            // A FILE WHOSE LOWERING REFUSED is `found` already, at its line, and is not emitted.
            emittable = []
            for (const source of read)
                if (!diagnosed.refused.has(source.path)) emittable.push(source)
        }
        const { ambient, unkeyed } = await session.lints(root, projected)
        // 11.37 — a build error, every read named.
        refusals.adopt(ambient)
        // What the emit throws with no one file to name is refused at the root; a refusal of a file
        // is refused at it.
        let emitWarnings: Diagnosis[] = []
        try {
            const whole = await emitApp(layout, session, emittable, refusals)
            Object.assign(app, whole)
            emitWarnings = whole.warnings
        } catch (thrown) {
            refusals.at(root, thrown)
        }
        // 11.30 — warned on, and the build goes on.
        app.warnings = [...warnings, ...unkeyed, ...emitWarnings]
        return {
            app,
            findings: [
                ...refusals.found,
                ...unkeyed,
                ...warnings,
                ...emitWarnings,
                ...found,
            ],
        }
    })
}

/** The emit half of `compiled`, over sources already laid out and read. */
async function emitApp(
    layout: Pick<
        AppLayout,
        'root' | 'handlers' | 'routes' | 'errors' | 'published'
    >,
    session: TypeSession,
    sources: readonly ReadSource<PlacedSource>[],
    refusals: Refusals,
): Promise<
    Pick<
        CompiledApp,
        'files' | 'tables' | 'handlers' | 'routes' | 'mounts' | 'warnings'
    >
> {
    const { root, routes, errors } = layout
    const files: Record<string, CompiledFile> = {}
    const tables: Record<string, string> = {}
    // 16.2 AND 16.28 — THE HANDLERS, read before a module is emitted: the server mounts each one,
    // and the browser holds its wrapper in its place — a handler file's as that file, a private
    // handler's in the server block's place in its own file's module. Written whether or not there
    // is a page: a handler is answered over http to a caller that has none.
    const { mounts, warnings } = await handlersUnder(
        session,
        sources,
        layout.handlers,
        refusals,
    )
    refuseSharedRoutes(routes, mounts, refusals)
    refuseAddressCollision(routes, mounts, layout.published, refusals)
    const standIns = standInsOf(mounts)
    // 37.1 — every module a server block or a handler file runs in, for the boot to import before
    // `onStart`.
    const servers: string[] = []
    for (const file of layout.handlers) servers.push(file.relative)
    let transitions = false
    for (const entry of sources) {
        let emitted: ReturnType<typeof emitSource>
        try {
            emitted = emitSource(
                entry,
                standIns.get(entry.relative),
                entry.text,
            )
        } catch (thrown) {
            refusals.at(entry.path, thrown)
            continue
        }
        if (entry.file.servers.length > 0) servers.push(entry.relative)
        transitions ||= emitted.transitions
        // 34.26 — a dependency's module runs on the app's runtime, whatever the package carries.
        const onAppRuntime = entry.dependency
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
    // TWO TABLES OFF ONE LAYOUT, each importing a file's `?component` face — the same addresses
    // either way, which is what keeps the pair from being two walks that can disagree. The
    // server's is written with no page too — an app of handlers alone still answers — and the
    // client's, with the entry that boots it, only where there is a page to boot.
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

/**
 * Refuses, naming both, where two files answer one method at one route — at the second.
 *
 * 19.1 — a page answers `GET` at its own, and a handler its method at its address.
 */
function refuseSharedRoutes(
    routes: AppRoute[],
    mounts: Mount[],
    refusals: Refusals,
): void {
    const owners = new Map<string, string>()
    const claim = (method: string, route: string, source: string): void => {
        const key = `${method} ${shapeOf(route)}`
        const owner = owners.get(key)
        if (owner === undefined) owners.set(key, source)
        else
            refusals.at(
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
 * Refuses, naming both, where a public file claims a route's address or another public file's — at
 * the public file.
 *
 * 36.13 — the walks that find routes and public files cannot see each other's collisions from
 * inside either one; this is where they meet, and naming BOTH is the clause. Two `public`
 * directories can claim one address too, since each mounts at the path above it (36.11). IN THE
 * COMPILE, so the build, dev and check all ask it (38.33), and `abide start` trusts the build:
 * `answerRequest` answers a public file AHEAD of any route on the ground that a collision cannot
 * exist at run time, and 30.8 says dev resolves an address the way the built app does.
 */
function refuseAddressCollision(
    routes: AppRoute[],
    mounts: Mount[],
    published: Map<string, string>,
    refusals: Refusals,
): void {
    const patterns = new Set<string>()
    for (const route of routes) patterns.add(route.pattern)
    for (const mount of mounts) patterns.add(mount.address)
    const claimed = new Map<string, string>()
    for (const [source, address] of published) {
        const other = claimed.get(address)
        if (patterns.has(address))
            refusals.at(
                source,
                new Error(
                    `abide: ${source} and the route ${address} claim the same address. RULEBOOK 36.13.`,
                ),
            )
        else if (other !== undefined)
            refusals.at(
                source,
                new Error(
                    `abide: ${other} and ${source} are both answered at ${address}. RULEBOOK 36.13.`,
                ),
            )
        else claimed.set(address, source)
    }
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
// from (RULEBOOK 30.7). Hydrating here rather than leaving it to the app is what makes the page the server
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

// THE ENTRY. An app does not write it: which module boots the client is the build's knowledge,
// exactly as the route table is, and a hand-written entry is one more file to keep in step with a
// layout that moves.
const ENTRY_MODULE = `// Written by \`abide build\`. What boots this app in a browser.
import { start } from '../${VIRTUAL_DIRECTORY}/${ROUTES_TABLE}'

start(document.body)
`
