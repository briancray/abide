import { existsSync, realpathSync } from 'node:fs' // bun exposes no sync existence check or realpath of its own
import { dirname, posix } from 'node:path' // bun exposes no path helpers of its own

import type { Mount } from '#server/answerRpc.ts'
import { CLIENT_ENTRY, WIRE_DIRECTORY } from '#server/CLIENT_BUILD.ts'
import { keyedHead, shellUnder } from '#server/render.ts'
import { CLIENT_ADDRESS } from '#shared/ADDRESSES.ts'
// The page's address from its path, read off `routePattern`'s own rule so the compiler and
// the routers cannot disagree about what a directory is called.
import { routeOf } from '#shared/routePattern.ts'
import type { Read } from './classifyRead.ts'
import { componentGraph } from './componentGraph.ts'
import { emitClient } from './emitClient.ts'
import { emitComponent } from './emitComponent.ts'
import { formatDiagnosis } from './formatDiagnosis.ts'
import { declaresHandlers, handlersUnder } from './handlersUnder.ts'
import { type AbideFile, parseAbide } from './parseAbide.ts'
import { ROUTING_SPECIFIER, WIRE_SPECIFIER } from './SPECIFIERS.ts'
import {
    markScoped,
    namesViewTransition,
    scopeCss,
    scopeToken,
} from './scopeStyles.ts'
import { type Diagnosis, TypeSession } from './TypeSession.ts'
import { writeDefaultProject } from './writeDefaultProject.ts'

// AN APP'S `.abide` SOURCES, COMPILED — every module the output tree holds, keyed by where it goes
// in it. Nothing here touches the output directory: `abide build` writes what this hands back and
// `abide dev` keeps it in memory (38.17), and the two commands serving different markup from the
// same sources is exactly what one compile in two sinks makes impossible.
//
// THE KEYS ARE THE OUTPUT LAYOUT, which mirrors the source tree so a module's neighbours are where
// its imports say they are — the relative specifier the compiler left alone resolves the same in
// either tree, and `componentGraph` is what makes the non-relative ones do the same.

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

/** An app's compiled output: every module by output path, its routes, and its warnings. */
export type CompiledApp = {
    /**
     * Module text by path below the output directory.
     *
     * `ui/pages/page.ts`, its `.client.ts`, and what the build writes rather than an author
     * (`routes.ts`, `server.ts`, `entry.ts`, `rpc.ts` and a wrapper per handler module under
     * `WIRE_DIRECTORY`).
     */
    modules: Map<string, string>
    routes: AppRoute[]
    /** How many `.abide` files were read, which is what the commands report. */
    sources: number
    /** What the compiler has to say that does not stop the build, on the `.abide` line. */
    warnings: Diagnosis[]
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
    /**
     * Records a path a watcher saw move, or `undefined` for a move it could not place.
     *
     * Held until `current`.
     */
    saw: (path: string | undefined) => void
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

/** Opens the checker for the app at `root`, on a default tsconfig where it has none (38.31). */
export async function openChecker(root: string): Promise<AppChecker> {
    // Where the app has no tsconfig it is typed against a default one (38.31), so every app is
    // read by the same compiler.
    const found = nearest(root, 'tsconfig.json')
    const opened = projectFiles(root)
    const project =
        found === undefined
            ? await writeDefaultProject(root)
            : { tsconfig: found, remove: async (): Promise<void> => {} }
    const session = await TypeSession.open(project.tsconfig)
    const moved = new Set<string>()
    let movedSomewhere = false
    return {
        session,
        saw: (path) => {
            if (path === undefined) movedSomewhere = true
            else moved.add(path)
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
            session.close()
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
 * Every `.abide` under the app, read, in path order — and the root as bun resolves it.
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
    const paths = [
        ...new Bun.Glob('**/*.abide').scanSync({ cwd: root, absolute: true }),
    ].sort()
    const texts = await Promise.all(paths.map((path) => Bun.file(path).text()))
    const sources: { path: string; text: string }[] = []
    for (let at = 0; at < paths.length; at += 1)
        sources.push({ path: paths[at] as string, text: texts[at] as string })
    return { root, sources }
}

/**
 * Compiles every `.abide` source and handler of the app at `appRoot` into its output modules.
 *
 * `kept` is a checker the caller holds across compiles and closes itself.
 */
export async function compileApp(
    appRoot: string,
    kept?: AppChecker,
): Promise<CompiledApp> {
    const { root, sources } = await sourcesUnder(appRoot)
    if (sources.length === 0 && !declaresHandlers(root))
        return { modules: new Map(), routes: [], sources: 0, warnings: [] }

    // One session for the whole build: opening it spawns the checker, and the cost is paid once
    // rather than per file.
    return withChecker(root, kept, async (session) => {
        const parsed: { path: string; text: string; file: AbideFile }[] = []
        for (const source of sources)
            parsed.push({ ...source, file: parseAbide(source.text) })

        // ONE SNAPSHOT FOR THE WHOLE BUILD. Asking file by file costs 19.7 ms each against 0.8 ms
        // sharing one, because what is expensive is adding a file to the project's root set
        // rather than asking about it — and a fresh build adds every file it has.
        const { reads, warnings } = await session.readsFor(parsed)
        // 11.37 — a build error, every read named, rather than a first one and a second run.
        const ambient = await session.ambientReads(root)
        if (ambient.length > 0) {
            const lines: string[] = []
            for (const read of ambient)
                lines.push(formatDiagnosis(read, process.cwd()))
            throw new Error(lines.join('\n'))
        }
        // 11.30 — warned on, and the build goes on.
        const unkeyed = await session.argsDefaults(root)
        const emitted = await emitApp(root, session, parsed, reads)
        return {
            ...emitted,
            sources: sources.length,
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
    sources: readonly { path: string; file: AbideFile }[],
    reads: readonly Read[][],
): Promise<Pick<CompiledApp, 'modules' | 'routes' | 'warnings'>> {
    const modules = new Map<string, string>()
    const routes: AppRoute[] = []
    const parsed: {
        path: string
        relative: string
        kind: FileKind
        file: AbideFile
    }[] = []
    for (const source of sources) {
        const relative = source.path.slice(root.length + 1)
        parsed.push({
            path: source.path,
            relative,
            kind: fileKind(relative),
            file: source.file,
        })
    }
    // 32.17 — WHICH FILES ARE INVOKED AS COMPONENTS, and where each import of one lands. A
    // caller's client module imports its child's, so a child with nothing to hydrate still
    // needs one to exist (the no-op below), and only a child carries its own markup
    // (`emitClient`). Built before the emit loop because a page may invoke a component the
    // walk reaches later.
    const graph = componentGraph(parsed, resolveFrom)

    // 30.7 — A ROUTABLE PAGE CARRIES ITS OWN MARKUP for the same reason an invoked component
    // does, and it is the same mechanism: a page the reader ARRIVED at was painted by the
    // server and hydrates, and a page they NAVIGATED to is handed the empty anchor pair and
    // fills it from the template in its own module. `emitClient`'s `isEmptyRegion` guard is
    // what makes one module serve both, so "routable" joins "invoked" as a module that fills
    // itself — and parts from it in how OFTEN it can be filled, which is what decides whether
    // the fill is markup or a build, and in carrying a head (`SelfFill`).
    const layouts: string[] = []
    for (const entry of parsed)
        if (entry.kind === 'layout') layouts.push(entry.relative)
    // 35.2 — every `error.abide`, with the directory it answers for and the layouts around it.
    const errors: AppRoute[] = []
    for (const entry of parsed) {
        if (entry.kind !== 'page' && entry.kind !== 'error') continue
        ;(entry.kind === 'page' ? routes : errors).push({
            pattern: routeOf(entry.relative),
            source: entry.relative,
            layouts: layoutsAround(entry.relative, layouts),
        })
    }

    // 39.8 — read off the `<style>` blocks here, once, rather than off the document at run time.
    let transitions = false
    for (let at = 0; at < parsed.length; at += 1) {
        const entry = parsed[at] as (typeof parsed)[number]
        const relative = entry.relative
        // 34.4 — A COMPONENT WITH STYLES: its elements carry its token, and the styles, scoped,
        // are a stylesheet its client module imports — which the bundle collects into the
        // stylesheet the document links (38.24).
        // 34.11 — each body's own `<style>`, scoped to the token its elements carry; the
        // component's token is added only where a component-level `<style>` requires it.
        const token = scopeToken(relative)
        const componentStyled = entry.file.styles.length > 0
        const bodies = markScoped(
            entry.file.template,
            token,
            componentStyled ? [token] : [],
            [],
            entry.file.components,
        )
        const styled = componentStyled || bodies.length > 0
        if (styled) {
            const styles = entry.file.styles.join('\n')
            let sheet = scopeCss(styles, token)
            for (const body of bodies) {
                sheet += `\n${scopeCss(body.css, body.token)}`
                transitions ||= namesViewTransition(body.css)
            }
            transitions ||= namesViewTransition(styles)
            modules.set(relative.replace(/\.abide$/, '.style.css'), sheet)
        }
        const fileReads = reads[at]
        const components = graph.imports.get(entry.path)
        modules.set(
            relative.replace(/\.abide$/, '.ts'),
            // 41.19 — a page and a layout are built a level at a time by `render`.
            emitComponent(
                entry.file,
                fileReads,
                entry.kind !== 'component',
                components,
            ),
        )

        // The client module is emitted only where there is something to hydrate, or where
        // something imports it by name (`emitClient` answers which). A static page has no
        // `.client.ts` beside it, which is what makes "this page ships no runtime" a fact about
        // the build rather than a claim about the bundler.
        // 35.1 — A LAYOUT CARRIES ITS OWN MARKUP for the same reason a routable page does:
        // nothing imports it, the router is what invokes it, and a reader who navigated to a
        // page under it may arrive with the layout already standing or with nothing at all.
        // An `error.abide` is never navigated to — only the server holds the error table.
        const name = relative.slice(relative.lastIndexOf('/') + 1)
        const routed = entry.kind === 'page' || entry.kind === 'layout'
        const selfFill = graph.invoked.has(entry.path)
            ? routed
                ? 'both'
                : 'invoked'
            : routed
              ? 'routed'
              : 'none'
        const client = emitClient(entry.file, fileReads, selfFill, components)
        const stylesheet = styled
            ? `import './${name.replace(/\.abide$/, '.style.css')}'\n`
            : ''
        if (client !== '')
            modules.set(
                relative.replace(/\.abide$/, '.client.ts'),
                stylesheet + client,
            )
    }
    // THE ROUTE TABLE, as the build's own knowledge rather than a list an app maintains. Which
    // addresses exist is a fact about the file tree (`page.abide` is an address, CLAUDE.md),
    // so a route that is not a directory cannot be written and a directory that is one cannot
    // be forgotten. The loaders are dynamic imports, which is what keeps a destination's
    // markup and bindings off the entry page's bundle until somebody navigates there.
    //
    // TWO TABLES OFF ONE WALK. The client's loads the `.client.ts` that mounts a page and the
    // server's loads the `.ts` that paints it — the same addresses either way, which is what
    // keeps the pair from being two walks that can disagree. The server's is written with no
    // page too — an app of handlers alone still answers — and the client's, with the entry
    // that boots it, only where there is a page to boot.
    modules.set('server.ts', serverTable(routes, errors))
    if (routes.length > 0) {
        // 39.14 — the shell the server paints this app into, read where the server reads it.
        const shellHead = keyedHead(await shellUnder(root))
        modules.set('routes.ts', clientTable(routes, transitions, shellHead))
        // The entry's SOURCE carries the name the bundle is written under — `entry-<hash>.js`
        // from a build and `entry.js` in dev — and its key in the manifest (38.23, 38.5).
        modules.set(`${CLIENT_ENTRY}.ts`, ENTRY_MODULE)
    }
    // 16.2 AND 16.29 — THE HANDLERS, TWICE OFF ONE READ: the table the server mounts them
    // from, and the module a browser is handed in place of each one's source. Written whether
    // or not there is a page: a handler is answered over http to a caller that has none.
    // 18.2 — and every socket, written into the same table and wrapped the same way.
    const { mounts, warnings } = await handlersUnder(root, session)
    modules.set('rpc.ts', mountTable(mounts))
    for (const [source, wrapper] of wrappersOf(mounts))
        modules.set(`${WIRE_DIRECTORY}/${source}`, wrapper)
    return { modules, routes, warnings }
}

type FileKind = 'page' | 'layout' | 'error' | 'component'

/**
 * Whether a source is a page, a layout, an error page or a component, by its path.
 *
 * AN ADDRESS RATHER THAN A NAME. Both halves are load-bearing: the file name is the address and
 * the directory is what says the address is a ROUTE rather than a component filed anywhere. One
 * test for both names (35.1 reads `layout.abide` the same way for the same reason), so the
 * directory half cannot be got right for one and wrong for the other.
 */
function fileKind(relative: string): FileKind {
    if (!relative.startsWith('pages/') && !relative.includes('/pages/'))
        return 'component'
    // The WHOLE basename: `homepage.abide` ends with `page.abide` and is a component.
    const name = relative.slice(relative.lastIndexOf('/') + 1)
    if (name === 'page.abide') return 'page'
    if (name === 'layout.abide') return 'layout'
    return name === 'error.abide' ? 'error' : 'component'
}

/**
 * The layouts a page renders inside, outermost first.
 *
 * Every `layout.abide` in a directory ON THE WAY DOWN to the page wraps it and no other does, so
 * the test is a prefix and the nesting order is the depth — which is what makes a section's own
 * chrome a file rather than a registration.
 */
function layoutsAround(page: string, layouts: string[]): string[] {
    const within = page.slice(0, page.lastIndexOf('/') + 1)
    const chain: string[] = []
    for (const layout of layouts) {
        const at = layout.slice(0, layout.lastIndexOf('/') + 1)
        if (within.startsWith(at)) chain.push(layout)
    }
    // A shorter directory is an outer one: they are prefixes of each other by construction.
    chain.sort((one, two) => one.length - two.length)
    return chain
}

/**
 * Resolves a specifier from a directory as bun does, or `undefined` where it does not resolve.
 *
 * A COMPONENT IMPORT RESOLVES THE WAY THE APP'S OWN IMPORTS DO — its import map, from the file
 * that wrote it. One that does not resolve is left as written, and the bundle names it.
 */
export function resolveFrom(
    specifier: string,
    from: string,
): string | undefined {
    try {
        return Bun.resolveSync(specifier, from)
    } catch {
        return undefined
    }
}

/**
 * The rows of either route table, one per route.
 *
 * The two differ only in which module a pattern loads, so a row is written once and the extension
 * is the argument.
 */
function tableOf(
    routes: AppRoute[],
    extension: string,
    column: (route: AppRoute) => string = () => '',
): string {
    const rows: string[] = []
    for (const route of routes) {
        const module = `./${route.source.replace(/\.abide$/, extension)}`
        // 35.1 — THE CHAIN IS PART OF THE ADDRESS, so it is in the table rather than resolved at
        // run time: which layouts wrap a page is a fact about the file tree, and the server and
        // the client read it off the same walk for the reason the addresses are (30.8).
        const wrapping = route.layouts.map(
            (layout) =>
                `() => import(${JSON.stringify(`./${layout.replace(/\.abide$/, extension)}`)})`,
        )
        rows.push(
            `    { pattern: ${JSON.stringify(route.pattern)}, load: () => import(${JSON.stringify(module)}), layouts: [${wrapping.join(', ')}]${column(route)} },`,
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
function clientTable(
    routes: AppRoute[],
    transitions: boolean,
    shellHead: string,
): string {
    return `// Written by \`abide build\`. The addresses this app answers, and what to load for each.
import { listenForRoutes, startRouter } from '${ROUTING_SPECIFIER}'

export const routes = [
${tableOf(routes, '.client.ts')}
]

// The router this document gets, the page it arrived on, and the two places a reader navigates
// from (30.7). Hydrating here rather than leaving it to the app is what makes the page the server
// painted live without anybody wiring it.
export function start(host: Element) {
    const router = startRouter(routes, host, ${transitions}, ${JSON.stringify(shellHead)})
    listenForRoutes(router)
    const ready = router.hydrate()
    return { router, ready }
}
`
}

/**
 * The source of `server.ts`: the same addresses, loading the module that PAINTS each page.
 *
 * No `start` here and nothing imported: the server holds the matching and the ranking already,
 * and a server table that carried either would be a second copy of both.
 */
function serverTable(routes: AppRoute[], errors: AppRoute[]): string {
    return `// Written by \`abide build\`. The addresses this app answers, and what paints each.
export const routes = [
${tableOf(routes, '.ts', clientModules)}
]

// 35.2 — the error pages, by the directory each answers for.
export const errors = [
${tableOf(errors, '.ts')}
]
`
}

/**
 * The server row's `clientModules` column: what the browser will load at this address.
 *
 * 38.29 — named on the SERVER's row: the server writes the document, and the preloads for the page
 * and its chain have to be in it before the client has run at all. Keys into the manifest
 * `manifestOf` reads off the bundle.
 */
function clientModules(route: AppRoute): string {
    const modules: string[] = []
    for (const source of [route.source, ...route.layouts])
        modules.push(source.replace(/\.abide$/, '.client.ts'))
    return `, clientModules: ${JSON.stringify(modules)}`
}

/** The source of `rpc.ts`: the handler rows `mountHandlers` answers from. */
function mountTable(mounts: Mount[]): string {
    return `// Written by \`abide build\`. Every handler this app answers over http and every socket it carries
// over the mux, and where each is.
export const handlers = ${JSON.stringify(mounts, null, 4)}
`
}

/**
 * The browser's stand-in module for each handler module, by source path.
 *
 * 16.29 — WHAT A BROWSER IMPORTS WHERE THE APP WROTE A HANDLER'S MODULE: the same export names,
 * each the same call over the wire. The address is written RELATIVE to the bundle's own directory
 * and resolved against the chunk at run time (16.11), so an app mounted under a sub-path calls its
 * own handlers rather than the root's.
 */
function wrappersOf(mounts: Mount[]): Map<string, string> {
    // IMPORTED BY WHAT THE MODULE USES: a handler module's page pays for no socket client.
    const modules = new Map<string, { body: string; uses: Set<string> }>()
    for (const mount of mounts) {
        // 20.4 — withheld from the browser: no wrapper, so an import of it is 16.30's refusal.
        if (!mount.ui) continue
        const at = JSON.stringify(posix.relative(CLIENT_ADDRESS, mount.address))
        const name = mount.method === 'SOCKET' ? 'socketWire' : 'wire'
        const method =
            mount.method === 'SOCKET' ? '' : `${JSON.stringify(mount.method)}, `
        // 18.19 — what the handler's value declares that the browser's copy behaves by.
        // 11.29 — and the defaults its parameter writes, which the copy keys by.
        const copy =
            mount.defaults !== undefined
                ? `, ${JSON.stringify(mount.copy)}, ${JSON.stringify(mount.defaults)}`
                : mount.copy === undefined
                  ? ''
                  : `, ${JSON.stringify(mount.copy)}`
        const call = `${name}(${method}new URL(${at}, import.meta.url).pathname${copy})`
        const line =
            mount.name === 'default'
                ? `export default ${call}\n`
                : `export const ${mount.name} = ${call}\n`
        const module = modules.get(mount.source)
        if (module === undefined)
            modules.set(mount.source, { body: line, uses: new Set([name]) })
        else {
            module.body += line
            module.uses.add(name)
        }
    }
    const wrappers = new Map<string, string>()
    for (const [source, { body, uses }] of modules)
        wrappers.set(
            source,
            `// Written by \`abide build\`. What a browser holds in place of ${source} (16.29).
import { ${[...uses].sort().join(', ')} } from '${WIRE_SPECIFIER}'

${body}`,
        )
    return wrappers
}

// THE ENTRY. An app does not write it: which module boots the client is the build's knowledge,
// exactly as the route table is, and a hand-written entry is one more file to keep in step with a
// layout that moves.
const ENTRY_MODULE = `// Written by \`abide build\`. What boots this app in a browser.
import { start } from './routes.ts'

start(document.body)
`

/**
 * The nearest file of this name at or above `from`, or `undefined`.
 *
 * The compiler needs a project for 31.3, and an app's own tsconfig is the one whose paths and lib
 * its pages are written against.
 */
function nearest(from: string, name: string): string | undefined {
    let at = from
    while (true) {
        const candidate = `${at}/${name}`
        if (existsSync(candidate)) return candidate
        const up = dirname(at)
        if (up === at) return undefined
        at = up
    }
}
