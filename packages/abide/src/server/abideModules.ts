// 34.14, 34.16, 32.17 — EVERY `.abide` IS SERVED AT ITS OWN PATH, compiled, by one plugin the runtime
// and the bundler share. Served there, a compiled module's relative, `#` and bare specifiers resolve
// from the file that wrote them through bun's own resolver — from the app, from a dependency under
// `node_modules`, or from a linked package outside the root alike — so nothing about a file's
// compile depends on where the build would have put it.
//
// WHICH FACE AN IMPORT GETS IS SPELLED ON ITS SPECIFIER (`MODULE_QUERIES`), because bun hands a plugin
// no import attributes: a compiled module asks for `?component`, a browser module for its own
// `?style`, a text import for `?text`. A `.abide` named bare is a module abide did not compile
// asking — on a server that is the bound face 34.16 states, and in a browser the component module
// itself.
//
// THE TABLES — the route, error and handler tables, and in a browser the router's table and the
// entry — are the build's own modules, served from `__abide` below the root, where no app writes.
//
// THE RUNTIME'S REGISTRATION IS THE PROCESS'S: a `.abide` filter is answered by the first plugin
// that registered one, so a second app booted in the same process — a test's — adds its compilation
// to this one rather than registering a plugin nobody asks.

import { basename, dirname, resolve } from 'node:path' // bun exposes no path helpers of its own
import { SERVER_SPECIFIER } from '#shared/SPECIFIERS.ts'
import type { ServerTable } from './answerRequest.ts'
import type { MountRow } from './answerRpc.ts'
import {
    type Asked,
    BOUND_NAMESPACE,
    CLIENT_NAMESPACE,
    componentNamespaceOf,
    type Face,
    faceOf,
    type HandlerFace,
    type Lane,
    realFileOf,
    STYLE_NAMESPACE,
    TEXT_NAMESPACE,
} from './faceOf.ts'
import { installSourceMaps, type SourceMaps } from './installSourceMaps.ts'
import {
    CLIENT_QUERY,
    COMPONENT_QUERY,
    HANDLER_FACE,
    HANDLER_SUFFIX,
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
    /**
     * Every handler file, by its path below the root: the route its hooks are filed at (37.1), and
     * the module a browser is handed in its place (16.74), `''` where the browser is handed none.
     */
    handlers: Record<string, HandlerFace>
    /** The build's own modules, by name below `__abide`. */
    tables: Record<string, string>
    /**
     * 23.19 — every directory a file mounts, by its path below the root, to the position its files
     * take: what the browser's fence reads a mounted file's place by (16.29).
     */
    mounted: Record<string, string>
}

const RELATIVE_OR_SUBPATH = /^(?:\.\.?\/|#)/

/** The plugin serving `compilation`'s files and tables, for one bundle. */
export function abideModules(
    root: string,
    compilation: Compilation,
): Bun.BunPlugin {
    const held: Held = {
        files: new Map(),
        handlers: new Map(),
        tables: new Map(),
    }
    addCompilation(realOrAsGiven(root), compilation, held)
    return modulesPlugin(held)
}

/**
 * A compilation as the plugin keys it, and answers from: a compiled file, a handler file or a table
 * by absolute path.
 */
type Held = {
    files: Map<string, CompiledFile>
    handlers: Map<string, HandlerFace>
    tables: Map<string, string>
}

const RUNTIME: Held = {
    files: new Map(),
    handlers: new Map(),
    tables: new Map(),
}
let registered = false

/**
 * Serves `compilation` to this process's imports from now on, and places a stack frame in each of
 * its files (38.97).
 */
export function serveCompilation(root: string, compilation: Compilation): void {
    const real = realOrAsGiven(root)
    const handlerFiles = addCompilation(real, compilation, RUNTIME)
    installSourceMaps(serverMapsOf(compilation, real), real)
    if (handlerFiles.length !== 0) Bun.plugin(handlerFilesPlugin(handlerFiles))
    if (registered) return
    registered = true
    Bun.plugin(modulesPlugin(RUNTIME))
}

// 16.2 — A HANDLER FILE LOADED AT ITS OWN PATH RE-EXPORTS ITS FACE, so every spelling of its import
// is the module the server mounted. The runtime asks `onResolve` only for a specifier with an
// extension, while `onLoad` is asked by the path the file resolved to, however it was spelled. One
// plugin per compilation because the filter is fixed at registration, and the runtime's `onLoad`
// cannot fall through, so the filter names the handler files and nothing else. The face it names
// is resolved by `modulesPlugin`, registered once.
function handlerFilesPlugin(paths: string[]): Bun.BunPlugin {
    return {
        name: 'abide-handler-files',
        setup(build) {
            build.onLoad(
                {
                    filter: new RegExp(
                        `^(?:${paths.map(RegExp.escape).join('|')})$`,
                    ),
                },
                (args) => ({
                    contents: `export { default } from ${JSON.stringify(`${args.path}${HANDLER_SUFFIX}`)}\n`,
                    loader: 'js',
                }),
            )
        },
    }
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

/** Adds `compilation` to `held`, and answers its handler files' absolute paths. */
function addCompilation(
    root: string,
    compilation: Compilation,
    held: Held,
): string[] {
    // RESOLVED, not joined: a dependency's file is keyed above the root (`../node_modules/…`).
    for (const [relative, compiled] of Object.entries(compilation.files))
        held.files.set(resolve(root, relative), compiled)
    const handlerFiles: string[] = []
    for (const [relative, face] of Object.entries(compilation.handlers)) {
        const path = resolve(root, relative)
        held.handlers.set(path, face)
        handlerFiles.push(path)
    }
    for (const [name, text] of Object.entries(compilation.tables))
        held.tables.set(`${root}/${VIRTUAL_DIRECTORY}/${name}`, text)
    return handlerFiles
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

function modulesPlugin(served: Held): Bun.BunPlugin {
    return {
        name: 'abide-modules',
        setup(build) {
            // THE LANE IS THE BUILD'S TARGET: a browser bundle gets each file's browser module, and
            // the runtime — which has no config — and a server bundle get its server module.
            const bundling: boolean = 'config' in build
            const lane: Lane = {
                bundling,
                browser: bundling && build.config.target === 'browser',
            }
            const resolved = (specifier: string, importer: string): string =>
                resolvedFile(specifier, dirname(pathOf(importer)))
            // Each hook below only adapts bun's ask to `faceOf`'s: the file the specifier resolved to,
            // its query taken off, and the answer handed back — a refusal thrown.
            const answer = (
                asked: Asked,
                file: string,
                importer: string,
            ): Face | undefined => {
                const face = faceOf(
                    asked,
                    file,
                    pathOf(importer),
                    lane,
                    served.handlers,
                )
                if (face instanceof Error) throw face
                return face
            }
            // A filter off the query's own constant, so renaming one cannot silently stop a match.
            const asking = (asked: Asked, query: string, filter: RegExp) =>
                build.onResolve({ filter }, (args) =>
                    resolving
                        ? undefined
                        : answer(
                              asked,
                              resolved(
                                  args.path.slice(
                                      0,
                                      args.path.length - query.length,
                                  ),
                                  args.importer,
                              ),
                              args.importer,
                          ),
                )
            const abideWith = (query: string) =>
                new RegExp(`\\.abide${RegExp.escape(query)}$`)
            asking(
                'text',
                TEXT_QUERY,
                new RegExp(`${RegExp.escape(TEXT_QUERY)}$`),
            )
            asking('style', STYLE_QUERY, abideWith(STYLE_QUERY))
            asking('component', COMPONENT_QUERY, abideWith(COMPONENT_QUERY))
            asking('client', CLIENT_QUERY, abideWith(CLIENT_QUERY))
            asking('abide', '', /\.abide$/)
            build.onResolve(
                { filter: new RegExp(`/${VIRTUAL_DIRECTORY}/[^/]+\\.ts$`) },
                (args) => {
                    if (resolving) return undefined
                    const path = resolve(
                        dirname(pathOf(args.importer)),
                        args.path,
                    )
                    return served.tables.get(path) === undefined
                        ? undefined
                        : { path, namespace: 'abide-table' }
                },
            )

            // A HANDLER FILE IS FOUND BY WHERE ITS IMPORT RESOLVES, however the import spells it — the
            // app's own, or a mounted package's own page importing a handler file of its (23.19).
            // THE FILTER IS THE HANDLER FILES' NAMES: a hook matching every relative import costs the
            // bundle abide's own `sideEffects`, and the barrel's rest — the validator, the csp — moved
            // into the chunk every page loads (38.94); and since only an import ending in one of those
            // names is resolved again, a package's other imports cost nothing, so a package's are not
            // passed over by where they lie. ONLY IN A BUNDLE: the runtime finds a handler file by the
            // path it loads at (`handlerFilesPlugin`), and asks no `onResolve` of an extensionless
            // specifier at all.
            // Each handler file's name without `.ts` — what an import of one ends in.
            const stems = new Set<string>()
            if (bundling)
                for (const path of served.handlers.keys())
                    stems.add(basename(path, '.ts'))
            if (stems.size !== 0)
                build.onResolve(
                    {
                        filter: new RegExp(
                            `(?:^|/)(?:${[...stems].map(RegExp.escape).join('|')})(?:\\.ts)?$`,
                        ),
                    },
                    (args) => {
                        if (resolving || !RELATIVE_OR_SUBPATH.test(args.path))
                            return undefined
                        let file: string
                        try {
                            file = resolved(args.path, args.importer)
                        } catch {
                            return undefined
                        }
                        return answer('handler', file, args.importer)
                    },
                )

            // A RELATIVE SPECIFIER A FACE IMPORTS AT RUN TIME is resolved from the file the face
            // stands for: bun's runtime reads one from an importer in a namespace as no path at
            // all. A bare one it resolves itself. Registered after every face, so a `.abide` is
            // still answered as one — and NOT IN A BUNDLE, which needs it for no face it serves,
            // and where a hook matching every relative import in a package costs the bundle that
            // package's `sideEffects`: a two-page app grew by 12 KB, the validator one page never
            // calls moved into the chunk both pages load.
            if (!bundling) {
                // A face `handlerFilesPlugin` re-exports, named by its absolute path, which no file
                // is at.
                build.onResolve({ filter: HANDLER_FACE }, (args) => ({
                    path: args.path,
                }))
                build.onResolve({ filter: /^\.\.?\// }, (args) =>
                    resolving || pathOf(args.importer) === args.importer
                        ? undefined
                        : { path: resolved(args.path, args.importer) },
                )
            }

            build.onLoad(
                { filter: /\.abide$/, namespace: componentNamespaceOf(lane) },
                (args) => {
                    const compiled = compiledAt(served, args.path)
                    return {
                        contents: lane.browser
                            ? compiled.client
                            : compiled.server,
                        loader: 'ts',
                    }
                },
            )
            // 16.74, 37.1 — A HANDLER FILE: the browser's is its wrapper, and the server's is the file
            // as written, between the two calls that file its hooks at its route — on its first
            // line, so every line of the file stays where its frames name it. ITS FACE is its path
            // with a suffix, in bun's own namespace — so what it imports, relative, `#` or bare,
            // resolves from its directory as the file's own imports do. A namespace of abide's own
            // had bun resolve a bare one from the working directory: a second abide, run from `/`.
            build.onLoad({ filter: HANDLER_FACE }, async (args) => {
                const path = realFileOf(args.path)
                const face = served.handlers.get(path) as HandlerFace
                if (lane.browser) return { contents: face.client, loader: 'js' }
                const text = await Bun.file(path).text()
                return {
                    contents: `import { fileRoute as __fileRoute } from '${SERVER_SPECIFIER}';__fileRoute(${JSON.stringify(face.scope)});${text}\n;__fileRoute(undefined)\n`,
                    loader: 'ts',
                }
            })
            build.onLoad(
                { filter: /.*/, namespace: CLIENT_NAMESPACE },
                (args) => ({
                    contents: compiledAt(served, realFileOf(args.path)).client,
                    loader: 'ts',
                }),
            )
            build.onLoad(
                { filter: /.*/, namespace: BOUND_NAMESPACE },
                (args) => {
                    const path = realFileOf(args.path)
                    return {
                        contents: boundModule(path),
                        loader: 'js',
                    }
                },
            )
            // A stylesheet is the bundle's; outside one there is no document to apply it to.
            build.onLoad(
                { filter: /.*/, namespace: STYLE_NAMESPACE },
                (args) =>
                    bundling
                        ? {
                              contents:
                                  compiledAt(served, realFileOf(args.path))
                                      .sheet ?? '',
                              loader: 'css',
                          }
                        : { contents: '', loader: 'js' },
            )
            build.onLoad(
                { filter: /.*/, namespace: TEXT_NAMESPACE },
                async (args) => ({
                    contents: `export default ${JSON.stringify(await Bun.file(realFileOf(args.path)).text())}\n`,
                    loader: 'js',
                }),
            )
            build.onLoad(
                { filter: /.*/, namespace: 'abide-table' },
                (args) => ({
                    contents: served.tables.get(args.path) ?? '',
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
function compiledAt(served: Held, path: string): CompiledFile {
    const compiled = served.files.get(path)
    if (compiled === undefined)
        throw new Error(
            `abide: ${path} is imported, and no compile of this app reached it.`,
        )
    return compiled
}

// 34.16 — BOUND, NOT RAW. The compiled module is a function of accessors answering its markup (33.4);
// what an app's own module calls is a function of plain props answering a `Component` (35.4), which
// `render` invokes with nothing. The component is the module's one export (34.17).
function boundModule(path: string): string {
    return `import component from ${JSON.stringify(path)}
export default (props = {}) => {
    const accessors = {}
    for (const key in props) {
        const value = props[key]
        accessors[key] = () => value
    }
    return () => component(accessors)
}
`
}
