// 34.14, 34.16, 32.17 — EVERY `.abide` IS SERVED AT ITS OWN PATH, compiled, by one plugin the runtime
// and the bundler share. Served there, a compiled module's relative, `#` and bare specifiers resolve
// from the file that wrote them through bun's own resolver — from the app, from a dependency under
// `node_modules`, or from a linked package outside the root alike — so nothing about a file's
// compile depends on where the build would have put it.
//
// WHICH FACE AN IMPORT GETS IS SPELLED ON ITS SPECIFIER (`MODULE_QUERIES`), because bun hands a plugin
// no import attributes: a compiled module asks for `?component`, a browser module for its own
// `?style`, a text import for `?text`. A `.abide` named bare is a module abide did not compile
// asking — on a server that is the bound face 34.16 states, beside every name the module exports,
// and in a browser the component module itself.
//
// THE TABLES — the route, error and handler tables, and in a browser the router's table and the
// entry — are the build's own modules, served from `__abide` below the root, where no app writes.
//
// THE RUNTIME'S REGISTRATION IS THE PROCESS'S: a `.abide` filter is answered by the first plugin
// that registered one, so a second app booted in the same process — a test's — adds its compilation
// to this one rather than registering a plugin nobody asks.

import { dirname, resolve } from 'node:path' // bun exposes no path helpers of its own
import type { ServerTable } from './answerRequest.ts'
import type { MountRow } from './answerRpc.ts'
import { installSourceMaps, type SourceMaps } from './installSourceMaps.ts'
import {
    CLIENT_QUERY,
    COMPONENT_QUERY,
    STYLE_QUERY,
    TEXT_QUERY,
} from './MODULE_QUERIES.ts'
import { realOrAsGiven } from './realOrAsGiven.ts'
import { SERVER_TABLE } from './TABLES.ts'
import { VIRTUAL_DIRECTORY } from './VIRTUAL_DIRECTORY.ts'

/** One `.abide`, compiled: its server module, its browser module, its stylesheet and their maps. */
export type CompiledFile = {
    server: string
    /** `''` where the file has nothing to hydrate and nothing imports it by name. */
    client: string
    sheet: string | undefined
    /** 38.97 — each module's `mappings` into the `.abide`, or `undefined` where it places nothing. */
    serverMappings: string | undefined
    clientMappings: string | undefined
}

/**
 * What a compile hands the plugin, and what `abide build` keeps and `abide dev` sends its worker.
 *
 * Every path RELATIVE TO THE ROOT, so a build moved to another directory or another machine is
 * served from wherever its root is then.
 */
export type Compilation = {
    /** Every `.abide` compiled, by its path below the root. */
    files: Record<string, CompiledFile>
    /** The build's own modules, by name below `__abide`. */
    tables: Record<string, string>
}

// A VIRTUAL FACE'S PATH: its file's, with a suffix that is not a query. Both registries key a module
// by its path whatever its namespace, and the runtime's drops a query from it — so a file's text, its
// stylesheet or its bound face under `?…` took the place of the module the file compiles to.
const BOUND = '::bound'
const CLIENT = '::client'
const TEXT = '::text'
const STYLE = '::style'

/** The namespace a bundle's component module is answered in, at its file's own path. */
export const COMPONENT_NAMESPACE = 'abide-component'
/** The namespaces a file's text and a component's stylesheet are loaded in. */
export const TEXT_NAMESPACE = 'abide-text'
export const STYLE_NAMESPACE = 'abide-style'

/** What the plugin answers from: a compiled file or a table by absolute path. */
type Served = {
    file: (path: string) => CompiledFile | undefined
    table: (path: string) => string | undefined
}

/** The plugin serving `compilation`'s files and tables, for one bundle. */
export function abideModules(
    root: string,
    compilation: Compilation,
): Bun.BunPlugin {
    const files = new Map<string, CompiledFile>()
    const tables = new Map<string, string>()
    addCompilation(realOrAsGiven(root), compilation, files, tables)
    return modulesPlugin({
        file: (path) => files.get(path),
        table: (path) => tables.get(path),
    })
}

const RUNTIME_FILES = new Map<string, CompiledFile>()
const RUNTIME_TABLES = new Map<string, string>()
let registered = false

/**
 * Serves `compilation` to this process's imports from now on, and places a stack frame in each of
 * its files (38.97).
 */
export function serveCompilation(root: string, compilation: Compilation): void {
    const real = realOrAsGiven(root)
    addCompilation(real, compilation, RUNTIME_FILES, RUNTIME_TABLES)
    installSourceMaps(serverMapsOf(compilation, real), real)
    if (registered) return
    registered = true
    Bun.plugin(
        modulesPlugin({
            file: (path) => RUNTIME_FILES.get(path),
            table: (path) => RUNTIME_TABLES.get(path),
        }),
    )
}

/** What the server's table exports: its routes and error pages, server blocks and handlers. */
export type BuiltTable = ServerTable & {
    /** 37.1 — every module a `<script server>` runs in, imported before the app boots. */
    servers: (() => Promise<unknown>)[]
    /** 16.2 — every handler, each row with its module's loader. */
    handlers: MountRow[]
}

/** The server's table of the app at `root`, out of the compilation this process serves. */
export function servedTable(root: string): Promise<BuiltTable> {
    return import(
        Bun.pathToFileURL(tablePath(root, SERVER_TABLE)).href
    ) as Promise<BuiltTable>
}

/** The path a table is imported at: `name` below `__abide` under `root`. */
export function tablePath(root: string, name: string): string {
    return `${realOrAsGiven(root)}/${VIRTUAL_DIRECTORY}/${name}`
}

/** Each server module's map, by the `.abide` it is served at, below `root`. */
export function serverMapsOf(
    compilation: Compilation,
    root: string,
): SourceMaps {
    const maps: SourceMaps = {}
    for (const [relative, compiled] of Object.entries(compilation.files))
        if (compiled.serverMappings !== undefined)
            maps[relative] = [resolve(root, relative), compiled.serverMappings]
    return maps
}

function addCompilation(
    root: string,
    compilation: Compilation,
    files: Map<string, CompiledFile>,
    tables: Map<string, string>,
): void {
    // RESOLVED, not joined: a dependency's file is keyed above the root (`../node_modules/…`).
    for (const [relative, compiled] of Object.entries(compilation.files))
        files.set(resolve(root, relative), compiled)
    for (const [name, text] of Object.entries(compilation.tables))
        tables.set(`${root}/${VIRTUAL_DIRECTORY}/${name}`, text)
}

// `Bun.resolveSync` asks EVERY abide plugin's `onResolve` again — this one's, and the runtime's, which
// is registered for the whole process and so answers inside a bundle too. One flag for all of them
// is what lets the inner ask fall through to bun's resolver rather than be answered again from a
// directory read as a file.
let resolving = false

/**
 * Where `specifier` resolves from the directory `from`, as bun's own resolver answers — never as a
 * face this plugin serves.
 *
 * The compiler asks where a `.abide` IS; in a process serving a compilation, the plugin would
 * answer with the face an import of it gets instead.
 */
export function resolvedFile(specifier: string, from: string): string {
    resolving = true
    try {
        return Bun.resolveSync(specifier, from)
    } finally {
        resolving = false
    }
}

function modulesPlugin(served: Served): Bun.BunPlugin {
    return {
        name: 'abide-modules',
        setup(build) {
            // THE LANE IS THE BUILD'S TARGET: a browser bundle gets each file's browser module, and
            // the runtime — which has no config — and a server bundle get its server module. A
            // browser module the runtime was asked for (`CLIENT_QUERY`) is the one exception, and
            // what it imports is in its lane.
            const bundling: boolean = 'config' in build
            const browser = bundling && build.config.target === 'browser'
            const inBrowser = (importer: string): boolean =>
                browser || pathOf(importer).endsWith(CLIENT)
            // A BUNDLE'S COMPONENT MODULE IS IN A NAMESPACE OF ITS OWN: the bundler refuses a
            // `file` path a plugin answers with `..` anywhere in it, which a `[...rest]` directory
            // writes (23.5). The runtime has no such check, and its stack frames name the path.
            const componentNamespace = bundling ? COMPONENT_NAMESPACE : 'file'
            // The module `path` compiles to, in the lane its importer is in.
            const componentFor = (path: string, importer: string) =>
                inBrowser(importer) && !browser
                    ? { path: `${path}${CLIENT}`, namespace: 'abide-client' }
                    : { path, namespace: componentNamespace }
            const resolved = (specifier: string, importer: string): string =>
                resolvedFile(specifier, dirname(pathOf(importer)))
            // A filter off the query's own constant, so renaming one cannot silently stop a match.
            const abideWith = (query: string) =>
                new RegExp(`\\.abide${RegExp.escape(query)}$`)

            build.onResolve(
                { filter: new RegExp(`${RegExp.escape(TEXT_QUERY)}$`) },
                (args) => {
                    if (resolving) return undefined
                    const specifier = args.path.slice(0, -TEXT_QUERY.length)
                    // A path of its own (`TEXT`): a file is often imported as code and as text at once
                    // — an example's Files tab.
                    return {
                        path: `${resolved(specifier, args.importer)}${TEXT}`,
                        namespace: TEXT_NAMESPACE,
                    }
                },
            )
            build.onResolve({ filter: abideWith(STYLE_QUERY) }, (args) => {
                if (resolving) return undefined
                const specifier = args.path.slice(0, -STYLE_QUERY.length)
                return {
                    path: `${resolved(specifier, args.importer)}${STYLE}`,
                    namespace: STYLE_NAMESPACE,
                }
            })
            build.onResolve({ filter: abideWith(COMPONENT_QUERY) }, (args) => {
                if (resolving) return undefined
                const specifier = args.path.slice(0, -COMPONENT_QUERY.length)
                return componentFor(
                    resolved(specifier, args.importer),
                    args.importer,
                )
            })
            build.onResolve({ filter: abideWith(CLIENT_QUERY) }, (args) => {
                if (resolving) return undefined
                const path = resolved(
                    args.path.slice(0, -CLIENT_QUERY.length),
                    args.importer,
                )
                return browser
                    ? { path, namespace: componentNamespace }
                    : { path: `${path}${CLIENT}`, namespace: 'abide-client' }
            })
            build.onResolve({ filter: /\.abide$/ }, (args) => {
                if (resolving) return undefined
                const path = resolved(args.path, args.importer)
                // A bound face's own import of its component, and every browser import, is the
                // component module.
                if (
                    inBrowser(args.importer) ||
                    pathOf(args.importer) === `${path}${BOUND}`
                )
                    return componentFor(path, args.importer)
                return { path: `${path}${BOUND}`, namespace: 'abide-bound' }
            })
            build.onResolve(
                { filter: new RegExp(`/${VIRTUAL_DIRECTORY}/[^/]+\\.ts$`) },
                (args) => {
                    if (resolving) return undefined
                    const path = resolve(
                        dirname(pathOf(args.importer)),
                        args.path,
                    )
                    return served.table(path) === undefined
                        ? undefined
                        : { path, namespace: 'abide-table' }
                },
            )

            // A RELATIVE SPECIFIER A FACE IMPORTS AT RUN TIME is resolved from the file the face
            // stands for: bun's runtime reads one from an importer in a namespace as no path at
            // all. A bare one it resolves itself. Registered after every face, so a `.abide` is
            // still answered as one — and NOT IN A BUNDLE, which needs it for no face it serves,
            // and where a hook matching every relative import in a package costs the bundle that
            // package's `sideEffects`: a two-page app grew by 12 KB, the validator one page never
            // calls moved into the chunk both pages load.
            if (!bundling)
                build.onResolve({ filter: /^\.\.?\// }, (args) =>
                    resolving || pathOf(args.importer) === args.importer
                        ? undefined
                        : { path: resolved(args.path, args.importer) },
                )

            build.onLoad(
                { filter: /\.abide$/, namespace: componentNamespace },
                (args) => {
                    const compiled = compiledAt(served, args.path)
                    return {
                        contents: browser ? compiled.client : compiled.server,
                        loader: 'ts',
                    }
                },
            )
            build.onLoad(
                { filter: /.*/, namespace: 'abide-client' },
                (args) => ({
                    contents: compiledAt(
                        served,
                        args.path.slice(0, -CLIENT.length),
                    ).client,
                    loader: 'ts',
                }),
            )
            build.onLoad({ filter: /.*/, namespace: 'abide-bound' }, (args) => {
                const path = args.path.slice(0, -BOUND.length)
                return {
                    contents: boundModule(
                        path,
                        compiledAt(served, path).server,
                    ),
                    loader: 'js',
                }
            })
            // A stylesheet is the bundle's; outside one there is no document to apply it to.
            build.onLoad(
                { filter: /.*/, namespace: STYLE_NAMESPACE },
                (args) =>
                    bundling
                        ? {
                              contents:
                                  compiledAt(
                                      served,
                                      args.path.slice(0, -STYLE.length),
                                  ).sheet ?? '',
                              loader: 'css',
                          }
                        : { contents: '', loader: 'js' },
            )
            build.onLoad(
                { filter: /.*/, namespace: TEXT_NAMESPACE },
                async (args) => ({
                    contents: `export default ${JSON.stringify(await Bun.file(args.path.slice(0, -TEXT.length)).text())}\n`,
                    loader: 'js',
                }),
            )
            build.onLoad(
                { filter: /.*/, namespace: 'abide-table' },
                (args) => ({
                    contents: served.table(args.path) ?? '',
                    loader: 'ts',
                }),
            )
        },
    }
}

// AN IMPORTER IN ONE OF THIS PLUGIN'S NAMESPACES CARRIES IT in front of its path at run time — with
// a `/` in front of that again, where the bundler hands the path alone.
function pathOf(importer: string): string {
    return importer.replace(/^\/?abide-[a-z]+:/, '')
}

// THE PATH BUN NAMES A FILE BY HAS ITS LINKS RESOLVED, and so has the root a compilation is served
// under (`serveCompilation`).
function compiledAt(served: Served, path: string): CompiledFile {
    const compiled = served.file(path)
    if (compiled === undefined)
        throw new Error(
            `abide: ${path} is imported, and no compile of this app reached it.`,
        )
    return compiled
}

const SCANNER = new Bun.Transpiler({ loader: 'ts' })

// 34.16 — BOUND, NOT RAW. The compiled module is a function of accessors answering its markup (33.4);
// what an app's own module calls is a function of plain props answering a `Component` (35.4), which
// `render` invokes with nothing. Every name the module exports rides beside it: a `<script module>`'s,
// and the handlers a `<script server>` declares (34.23).
//
// NAMED RATHER THAN `export *`: the server blocks load side by side at boot, and a star export
// through a module still loading found none of its names.
function boundModule(path: string, server: string): string {
    const specifier = JSON.stringify(path)
    const names: string[] = []
    for (const name of SCANNER.scan(server).exports)
        if (name !== 'default') names.push(name)
    return `import component from ${specifier}
${names.length === 0 ? '' : `export { ${names.join(', ')} } from ${specifier}\n`}export default (props = {}) => {
    const accessors = {}
    for (const key in props) {
        const value = props[key]
        accessors[key] = () => value
    }
    return () => component(accessors)
}
`
}
