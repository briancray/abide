// `.abide` EMIT FAÇADE (Stage 1, PR3/PR4) — BUILD/SSR-SIDE ENTRY.
//
// Ties parse → analyzeBindings → buildPlan → emit{Client,Server}Module together. `emitModuleSource`
// returns the two ES-module strings (consumed later by clientBundle / pages at cutover);
// `loadEmitted` instantiates them (cached, via a temp-file dynamic import with the runtime specifiers
// resolved to absolute paths) so tests can drive the emitted `render`/`mount`/`hydrate` directly.
//
// This module uses the TS7 scanner (through analyzeBindings) and NEVER ships to the browser.

import { unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { analyzeBindings, type BindingAnalysis } from './analyzeBindings.ts'
import { emitClientModule } from './emitClient.ts'
import { emitServerModule } from './emitServer.ts'
import { parse } from './parse.ts'
import { resolvePassThroughImport } from './resolvePassThroughImport.ts'
import { resolveTemplateAlias } from './resolveTemplateAlias.ts'
import { buildPlan } from './templatePlan.ts'

export interface EmittedSource {
    client: string
    server: string
    // The scope analysis the two emits were built from. Carried on the result so a caller that needs
    // the source's component/css/module imports (the temp-module tree walk, the client bundler) reads
    // them off the cache instead of re-running `parse` + `analyzeBindings` over the same string.
    analysis: BindingAnalysis
}

export interface EmittedModule {
    render(scope?: Record<string, unknown>): Promise<string>
    // `anchor` (TODO #7): position this level before a node when mounted as a composed layer.
    mount(target: Element, scope?: Record<string, unknown>, anchor?: Node | null): () => void
    hydrate(container: Element, scope?: Record<string, unknown>): () => void
}

// Maps a `.abide` component import specifier (as written, e.g. `./Card.abide`) to the referenced
// component's SOURCE. Lets the harness resolve cross-file `<Card>` imports hermetically (no filesystem)
// — production dir-relative resolution is PR3/PR4. Returning `undefined` for a specifier that appears
// in `analysis.componentImports` is an error.
export type ComponentResolver = (specifier: string) => string | undefined

// Internal resolver used while walking the component-import tree: maps a `.abide` import specifier
// (as written) + the IMPORTER's dir to the referenced component's SOURCE and its own dir (so a nested
// component's imports resolve relative to ITS location). The harness (a `ComponentResolver`) is dir-
// free (`dir: undefined`); production SSR (`instantiateServer(source, dir)`) resolves against the
// filesystem rooted at the importer's dir.
type TreeResolver = (
    specifier: string,
    local: string,
    fromDir: string | undefined,
) => Promise<{ source: string; dir: string | undefined }>

// Wrap a hermetic `ComponentResolver` (source-only, no filesystem) as a `TreeResolver`.
function harnessResolver(resolve: ComponentResolver): TreeResolver {
    return async (specifier) => {
        const source = resolve(specifier)
        if (source === undefined)
            throw new Error(`loadEmitted: could not resolve component import "${specifier}"`)
        return { source, dir: undefined }
    }
}

// Resolve `.abide` component imports against the real filesystem, relative to the importer's dir
// (production SSR). A component's own dir becomes the base for ITS nested imports.
const filesystemResolver: TreeResolver = async (specifier, local, fromDir) => {
    if (fromDir === undefined) {
        throw new Error(
            `loadEmittedServer: <${local}> imports "${specifier}" but the importer's source dir is unknown`,
        )
    }
    const absolute = resolveTemplateAlias(specifier, fromDir) ?? join(fromDir, specifier)
    const source = await Bun.file(absolute).text()
    return { source, dir: dirname(absolute) }
}

const SOURCE_CACHE = new Map<string, EmittedSource>()
const MODULE_CACHE = new Map<string, Promise<EmittedModule>>()

const INTERNAL_DIR = import.meta.dir

// An ordinary import passes through as a REAL import only if it can actually be resolved from where the
// source lives. `sourceDir` is what makes that decidable — and it is absent for source-only callers (the
// hermetic test harness, LSP snippets, `emitModuleSource(source)` in tests), where nothing is on disk to
// resolve against. There, only abide's own surface passes through and everything else stays a `$scope`
// read, which is exactly how a source-only harness injects a module binding it never wrote to disk.
//
// With a dir in hand there is no such excuse: a specifier that resolves to nothing is a BUILD ERROR
// (`resolvePassThroughImport` throws and names it), not a binding that silently arrives `undefined`.
function passesThrough(specifier: string, sourceDir: string | undefined): boolean {
    if (sourceDir === undefined) {
        return specifier.startsWith('abide/shared/') || specifier.startsWith('abide/ui/')
    }
    resolvePassThroughImport(specifier, sourceDir)
    return true
}

export function emitModuleSource(source: string, sourceDir?: string): EmittedSource {
    const cacheKey = `${sourceDir ?? ''}\u0000${source}`
    const cached = SOURCE_CACHE.get(cacheKey)
    if (cached !== undefined) return cached
    const root = parse(source)
    const raw = analyzeBindings(root)
    const analysis: BindingAnalysis = {
        ...raw,
        moduleImports: raw.moduleImports.filter((binding) =>
            passesThrough(binding.specifier, sourceDir),
        ),
    }
    const plan = buildPlan(root, analysis)
    const result: EmittedSource = {
        client: emitClientModule(plan, analysis),
        server: emitServerModule(plan, analysis),
        analysis,
    }
    SOURCE_CACHE.set(cacheKey, result)
    return result
}

let counter = 0

export function loadEmitted(source: string, resolve?: ComponentResolver): Promise<EmittedModule> {
    // A resolver makes the result dependent on more than `source`, so bypass the source-keyed cache.
    if (resolve !== undefined) return instantiate(source, resolve)
    const existing = MODULE_CACHE.get(source)
    if (existing !== undefined) return existing
    const promise = instantiate(source)
    MODULE_CACHE.set(source, promise)
    return promise
}

// A server-render module: only the emitted `render($scope)`. Unlike `loadEmitted`, this NEVER
// imports the client module, so it works in a pure server process with no DOM (the emitted client
// evaluates `$rt.template(...)` at module top, which needs `document`). Used by SSR (`pages.ts`),
// where shipping/evaluating client code on the server would be both wrong and unnecessary.
export interface EmittedServerModule {
    render(scope?: Record<string, unknown>): Promise<string>
}

const SERVER_MODULE_CACHE = new Map<string, Promise<EmittedServerModule>>()

// `dir` (production SSR): the source's own directory, used to resolve its `.abide` component imports
// against the filesystem (recursively, each component relative to its own dir). `resolve` (harness):
// a hermetic source-only resolver, used instead of the filesystem. The cache key is `dir + source`
// (a component graph depends on the importer's dir); a `resolve` bypasses the cache (as before).
export function loadEmittedServer(
    source: string,
    dir?: string,
    resolve?: ComponentResolver,
): Promise<EmittedServerModule> {
    if (resolve !== undefined) return instantiateServer(source, dir, resolve)
    const key = `${dir ?? ''} ${source}`
    const existing = SERVER_MODULE_CACHE.get(key)
    if (existing !== undefined) return existing
    const promise = instantiateServer(source, dir)
    SERVER_MODULE_CACHE.set(key, promise)
    return promise
}

// Emit one side (`client`/`server`) of `source` — plus, recursively, every `.abide` component it
// imports — to sibling temp modules, rewriting the runtime specifier and each component-import
// specifier to the corresponding temp file (same string-replace technique as
// `clientBundle.resolveCssImports`). `written` dedups by source (component-imports-component + diamond
// imports share one temp module) AND guards import cycles (registered before recursing). Returns the
// emitted module's sibling basename; `files` accumulates every written path for cleanup.
async function emitTree(
    source: string,
    dir: string | undefined,
    side: 'client' | 'server',
    resolve: TreeResolver | undefined,
    written: Map<string, string>,
    files: string[],
): Promise<string> {
    // Dedup + cycle guard by `dir + source` — the same file (identical source AND dir) shares one temp
    // module; a component-imports-component cycle re-enters with the same key and short-circuits.
    const key = `${dir ?? ''} ${source}`
    const cached = written.get(key)
    if (cached !== undefined) return cached

    const emitted = emitModuleSource(source, dir)
    const runtimeFrom =
        side === 'client' ? '"abide/ui/internal/runtime"' : '"abide/ui/internal/serverRuntime"'
    const runtimeTo = side === 'client' ? '"./runtime.ts"' : '"./serverRuntime.ts"'
    let src = (side === 'client' ? emitted.client : emitted.server).replace(runtimeFrom, runtimeTo)

    // The compiled module is written into abide's own internal dir, not next to the `.abide`, so an
    // ordinary import ("./util.ts", "@scope/pkg", "$shared/x") would resolve against the wrong base.
    // Rewrite each to an absolute path resolved from the SOURCE's dir before it is written.
    for (const binding of emitted.analysis.moduleImports) {
        const absolute = resolvePassThroughImport(binding.specifier, dir)
        src = src.replaceAll(
            `from ${JSON.stringify(binding.specifier)}`,
            `from ${JSON.stringify(absolute)}`,
        )
    }

    const id = `${process.pid}-${Date.now()}-${counter++}`
    const basename = `.emit-${id}.${side}.ts`
    written.set(key, basename) // register before recursion (cycle guard)

    for (const componentImport of emitted.analysis.componentImports) {
        if (resolve === undefined) {
            throw new Error(
                `loadEmitted: <${componentImport.local}> imports "${componentImport.specifier}" but no component resolver was provided`,
            )
        }
        const child = await resolve(componentImport.specifier, componentImport.local, dir)
        const childBasename = await emitTree(child.source, child.dir, side, resolve, written, files)
        src = src.replaceAll(
            `from ${JSON.stringify(componentImport.specifier)}`,
            `from ${JSON.stringify(`./${childBasename}`)}`,
        )
    }

    const file = `${INTERNAL_DIR}/${basename}`
    await Bun.write(file, src)
    files.push(file)
    return basename
}

async function instantiateServer(
    source: string,
    dir?: string,
    resolve?: ComponentResolver,
): Promise<EmittedServerModule> {
    const files: string[] = []
    const treeResolve = resolve !== undefined ? harnessResolver(resolve) : filesystemResolver
    const serverBasename = await emitTree(source, dir, 'server', treeResolve, new Map(), files)
    try {
        const serverMod = (await import(
            pathToFileURL(`${INTERNAL_DIR}/${serverBasename}`).href
        )) as {
            render: (s?: Record<string, unknown>) => Promise<string>
        }
        return { render: serverMod.render }
    } finally {
        for (const file of files) await unlink(file).catch(() => {})
    }
}

async function instantiate(source: string, resolve?: ComponentResolver): Promise<EmittedModule> {
    const files: string[] = []
    const treeResolve = resolve !== undefined ? harnessResolver(resolve) : undefined
    const clientBasename = await emitTree(
        source,
        undefined,
        'client',
        treeResolve,
        new Map(),
        files,
    )
    const serverBasename = await emitTree(
        source,
        undefined,
        'server',
        treeResolve,
        new Map(),
        files,
    )
    try {
        const clientMod = (await import(
            pathToFileURL(`${INTERNAL_DIR}/${clientBasename}`).href
        )) as {
            mount: (t: Element, s?: Record<string, unknown>, a?: Node | null) => () => void
            hydrate: (c: Element, s?: Record<string, unknown>) => () => void
        }
        const serverMod = (await import(
            pathToFileURL(`${INTERNAL_DIR}/${serverBasename}`).href
        )) as { render: (s?: Record<string, unknown>) => Promise<string> }
        return { render: serverMod.render, mount: clientMod.mount, hydrate: clientMod.hydrate }
    } finally {
        for (const file of files) await unlink(file).catch(() => {})
    }
}
