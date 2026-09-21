import { existsSync } from 'node:fs' // bun exposes no sync existence check of its own
import { dirname, relative as relativePath } from 'node:path' // bun exposes no path helpers of its own

import { CLIENT_ENTRY } from '#server/CLIENT_BUILD.ts'
import { emitClient } from './emitClient.ts'
import { emitComponent } from './emitComponent.ts'
import { invokedComponents } from './invokedComponents.ts'
import { type AbideFile, parseAbide } from './parseAbide.ts'
import { ROUTING_SPECIFIER } from './SPECIFIERS.ts'
import { TypeSession } from './TypeSession.ts'

// AN APP'S `.abide` SOURCES, COMPILED — every module the output tree holds, keyed by where it goes
// in it. Nothing here touches the output directory: `abide build` writes what this hands back and
// `abide dev` keeps it in memory (38.17), and the two commands serving different markup from the
// same sources is exactly what one compile in two sinks makes impossible.
//
// THE KEYS ARE THE OUTPUT LAYOUT, which mirrors the source tree so a module's neighbours are where
// its imports say they are — the relative specifier the compiler left alone resolves the same in
// either tree, and `componentPaths` below is what makes the non-relative ones do the same.

export type AppRoute = {
    // The address, in the bracket spelling `routePattern` parses.
    pattern: string
    // The `.abide` this route paints, relative to the app root.
    source: string
}

export type CompiledApp = {
    // Module text by path below the output directory: `ui/pages/page.ts`, its `.client.ts`, and
    // the three the build writes rather than an author (`routes.ts`, `server.ts`, `entry.ts`).
    modules: Map<string, string>
    routes: AppRoute[]
    // How many `.abide` files were read, which is what the commands report.
    sources: number
}

export async function compileApp(root: string): Promise<CompiledApp> {
    const sources = [
        ...new Bun.Glob('**/*.abide').scanSync({ cwd: root, absolute: true }),
    ].sort()
    const modules = new Map<string, string>()
    const routes: AppRoute[] = []
    if (sources.length === 0) return { modules, routes, sources: 0 }

    // One session for the whole build: opening it spawns the checker, and the cost is paid once
    // rather than per file. Where no tsconfig is found the build still runs and every name reads
    // as written — 19.12 rather than a refusal.
    const tsconfig = findTsconfig(root)
    const session =
        tsconfig === undefined ? undefined : await TypeSession.open(tsconfig)
    try {
        const parsed: { path: string; file: AbideFile; text: string }[] = []
        for (const source of sources) {
            const text = await Bun.file(source).text()
            parsed.push({ path: source, file: parseAbide(text), text })
        }

        // ONE SNAPSHOT FOR THE WHOLE BUILD. Asking file by file costs 19.7 ms each against 0.8 ms
        // sharing one, because what is expensive is adding a file to the project's root set
        // rather than asking about it — and a fresh build adds every file it has.
        const reads = await session?.readsFor(parsed)

        // 32.18 — WHICH FILES ARE INVOKED AS COMPONENTS. A caller's client module imports its
        // child's, so a child with nothing to hydrate still needs one to exist (the no-op below),
        // and only a child carries its own markup (`emitClient`).
        const invoked = invokedComponents(parsed.map((entry) => entry.text))

        // WHERE EVERY `.abide` LANDS IN THE OUTPUT, by its absolute source path. Read by
        // `componentPaths` to turn an import of a component into a path inside this tree, and
        // built before the emit loop because a page may invoke a component the walk reaches later.
        const compiled = new Map<string, string>()
        for (const entry of parsed)
            compiled.set(entry.path, entry.path.slice(root.length + 1))

        // 30.7 — A ROUTABLE PAGE CARRIES ITS OWN MARKUP for the same reason an invoked component
        // does, and it is the same mechanism: a page the reader ARRIVED at was painted by the
        // server and hydrates, and a page they NAVIGATED to is handed the empty anchor pair and
        // fills it from the template in its own module. `emitClient`'s `isEmptyRegion` guard is
        // what makes one module serve both, so "routable" joins "invoked" rather than forking it.
        for (const entry of parsed) {
            const relative = compiled.get(entry.path) as string
            if (!isPage(relative)) continue
            routes.push({ pattern: routeOf(relative), source: relative })
        }

        for (let at = 0; at < parsed.length; at += 1) {
            const entry = parsed[at] as (typeof parsed)[number]
            const relative = compiled.get(entry.path) as string
            const fileReads = reads?.[at]
            const from = dirname(entry.path)
            modules.set(
                relative.replace(/\.abide$/, '.ts'),
                componentPaths(
                    emitComponent(entry.file, fileReads),
                    root,
                    from,
                    compiled,
                ),
            )

            // The client module is emitted only where there is something to hydrate. A static
            // page has no `.client.ts` beside it, which is what makes "this page ships no
            // runtime" a fact about the build rather than a claim about the bundler.
            //
            // A COMPONENT SOMEBODY INVOKES IS THE EXCEPTION, and it is the import that forces it:
            // the caller's client module names the child's, so a child with nothing to hydrate
            // needs a module for that name to resolve to. The no-op is what it ships.
            const name = relative.slice(relative.lastIndexOf('/') + 1)
            const client = emitClient(
                entry.file,
                fileReads,
                invoked.has(name) || isPage(relative),
            )
            if (client !== '' || invoked.has(name))
                modules.set(
                    relative.replace(/\.abide$/, '.client.ts'),
                    client === ''
                        ? 'export default () => {}\n'
                        : componentPaths(client, root, from, compiled),
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
        // keeps the pair from being two walks that can disagree. A build with no page writes
        // neither, and a command with nothing to answer says so.
        if (routes.length > 0) {
            modules.set('routes.ts', clientTable(routes))
            modules.set('server.ts', serverTable(routes))
            // The entry's SOURCE carries the name the bundle is written under, which is what
            // makes `<out>/client/entry.js` the address the shell writes (38.23).
            modules.set(`${CLIENT_ENTRY}.ts`, ENTRY_MODULE)
        }
    } finally {
        session?.close()
    }
    return { modules, routes, sources: sources.length }
}

// `page.abide` under a `pages/` directory. Both halves are load-bearing: the name is the address
// and the directory is what says the address is a ROUTE rather than a component filed anywhere.
export function isPage(relative: string): boolean {
    return (
        relative.endsWith('page.abide') &&
        (relative.startsWith('pages/') || relative.includes('/pages/'))
    )
}

// A COMPONENT IMPORT IS A PATH IN THE OUTPUT TREE, NOT IN THE SOURCE TREE. The compiler swaps the
// extension a `.abide` import carries (`splitImports`) and stops there, because from inside one
// file the layout the module lands in is not visible. It is visible HERE: every `.abide` compiles
// to the same position under the output directory, so the specifier is resolved against the
// source, looked up in that map, and rewritten relative.
//
// WITHOUT THIS A COMPONENT IMPORT RESOLVES INTO THE SOURCE TREE, where `#ui/components/Row.ts` is
// a file nobody wrote — the page compiles, the build succeeds, and the app fails to load the
// first time somebody asks for the address. A relative import needs none of it: the two trees
// mirror each other, so `./Row.ts` already lands beside the same neighbour in both.
function componentPaths(
    module: string,
    root: string,
    from: string,
    compiled: Map<string, string>,
): string {
    if (!module.includes('.ts')) return module
    return module.replace(
        /from '([^'\n]+?)(\.client)?\.ts'/g,
        (whole, specifier: string, lane: string | undefined) => {
            if (specifier.startsWith('.')) return whole
            // THE `.abide` IS WHAT RESOLVES. The `.ts` the emitter wrote does not exist anywhere,
            // so the question is asked of the file the author imported — and a specifier with no
            // `.abide` behind it (`#shared/money.ts`) answers by not resolving and is left alone.
            let source: string
            try {
                source = Bun.resolveSync(`${specifier}.abide`, from)
            } catch {
                return whole
            }
            const target = compiled.get(source)
            if (target === undefined) return whole
            // BOTH ENDS ARE `.abide` FILES, and both land at the same position below the output
            // directory that they hold below the root — so the path between the sources IS the
            // path between the modules.
            const path = relativePath(
                from === root ? '.' : from.slice(root.length + 1),
                target.replace(/\.abide$/, `${lane ?? ''}.ts`),
            )
            return `from '${path.startsWith('.') ? path : `./${path}`}'`
        },
    )
}

// THE PAGE'S ADDRESS FROM ITS PATH, read off `routePattern`'s own rule so the compiler and the
// routers cannot disagree about what a directory is called.
function routeOf(pagePath: string): string {
    const at = pagePath.lastIndexOf('/pages/')
    const tail = at === -1 ? pagePath : pagePath.slice(at + '/pages/'.length)
    const parts: string[] = []
    for (const part of tail.split('/'))
        if (part !== '' && !part.endsWith('.abide')) parts.push(part)
    return `/${parts.join('/')}`
}

// One row of either table. The two differ only in which module a pattern loads, so the row is
// written once and the extension is the argument.
function tableOf(routes: AppRoute[], extension: string): string {
    const rows: string[] = []
    for (const route of routes) {
        const module = `./${route.source.replace(/\.abide$/, extension)}`
        rows.push(
            `    { pattern: ${JSON.stringify(route.pattern)}, load: () => import(${JSON.stringify(module)}) },`,
        )
    }
    return rows.join('\n')
}

// `host: Element` IS NOT DECORATION. This is a `.ts` file an app bundles, so an app whose own
// tsconfig includes its build output typechecks it — and a bare `host` is an implicit `any` that
// fails `tsc` under the `strict` every abide app is written against.
function clientTable(routes: AppRoute[]): string {
    return `// Written by \`abide build\`. The addresses this app answers, and what to load for each.
import { listenForRoutes, startRouter } from '${ROUTING_SPECIFIER}'

export const routes = [
${tableOf(routes, '.client.ts')}
]

// The router this document gets, the page it arrived on, and the two places a reader navigates
// from (30.7). Hydrating here rather than leaving it to the app is what makes the page the server
// painted live without anybody wiring it.
export function start(host: Element) {
    const router = startRouter(routes, host)
    listenForRoutes(router)
    const ready = router.hydrate()
    return { router, ready }
}
`
}

// The same addresses, loading the module that PAINTS a page rather than the one that mounts it.
// No `start` here and nothing imported: the server holds the matching and the ranking already,
// and a server table that carried either would be a second copy of both.
function serverTable(routes: AppRoute[]): string {
    return `// Written by \`abide build\`. The addresses this app answers, and what paints each.
export const routes = [
${tableOf(routes, '.ts')}
]
`
}

// THE ENTRY. An app does not write it: which module boots the client is the build's knowledge,
// exactly as the route table is, and a hand-written entry is one more file to keep in step with a
// layout that moves.
const ENTRY_MODULE = `// Written by \`abide build\`. What boots this app in a browser.
import { start } from './routes.ts'

start(document.body)
`

// The nearest tsconfig.json at or above `from`. The compiler needs a project for 31.3, and an
// app's own is the one whose paths and lib its pages are written against.
function findTsconfig(from: string): string | undefined {
    let at = from
    while (true) {
        const candidate = `${at}/tsconfig.json`
        if (existsSync(candidate)) return candidate
        const up = dirname(at)
        if (up === at) return undefined
        at = up
    }
}
