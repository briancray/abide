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

// Inside a `bun build --compile` binary abide's own directory is the read-only virtual filesystem
// (`/$bunfs/root`, `B:\~BUN\root` on Windows), so the SSR temp-module dance cannot run there — and its
// failure would otherwise surface as a bare ENOENT naming a path nobody wrote. A compiled binary is
// supposed to carry every page's server module as a pre-emitted static import (`emitServerTree`), so a
// miss means the compile step and the render disagree about a source: say that, and say which page.
const IN_COMPILED_BINARY = INTERNAL_DIR.startsWith('/$bunfs') || INTERNAL_DIR.includes('~BUN')

function refuseRuntimeEmitInBinary(source: string, dir: string | undefined): void {
    if (!IN_COMPILED_BINARY) return
    throw new Error(
        `abide: this compiled binary has no pre-emitted server module for ${dir ?? '<unknown dir>'} ` +
            `(${source.slice(0, 80).replace(/\s+/g, ' ')}…) and cannot compile .abide at runtime. ` +
            `Rebuild the executable with \`abide compile\`.`,
    )
}

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
    const key = serverModuleKey(source, dir)
    const existing = SERVER_MODULE_CACHE.get(key)
    if (existing !== undefined) return existing
    const promise = instantiateServer(source, dir)
    SERVER_MODULE_CACHE.set(key, promise)
    return promise
}

function serverModuleKey(source: string, dir: string | undefined): string {
    return `${dir ?? ''} ${source}`
}

// Seed the cache with a module emitted AHEAD of time (`abide compile`): the standalone binary carries
// each page's server module as a static import, so `loadEmittedServer` must find it rather than try to
// compile the `.abide` again — inside the binary there is no source tree to read and no writable
// directory to emit into. Keyed identically to a runtime compile, so `renderPage`/`warmPages` are
// unchanged and simply hit a warm cache.
export function registerEmittedServer(
    source: string,
    dir: string,
    module: EmittedServerModule,
): void {
    SERVER_MODULE_CACHE.set(serverModuleKey(source, dir), Promise.resolve(module))
}

// WHERE a tree of emitted modules is written and how each file is named. Two callers, two answers:
// the SSR path writes throwaway siblings inside abide's own internal dir (so the runtime import
// becomes a relative sibling and the name only has to be unique for this process), while `abide
// compile` writes a durable tree into the app's build dir that Bun then bundles (so the runtime stays
// the `abide/...` package specifier the app resolves, and the name must be stable — the same source
// must produce the same file on every build for a reproducible binary).
interface EmitTarget {
    outDir: string
    // True for the SSR temp path: the emitted module sits beside `runtime.ts`/`serverRuntime.ts`.
    siblingRuntime: boolean
    name(key: string, side: 'client' | 'server'): string
}

// Emit one side (`client`/`server`) of `source` — plus, recursively, every `.abide` component it
// imports — into `target`, rewriting the runtime specifier and each component-import specifier to the
// corresponding emitted file (same string-replace technique as `clientBundle.resolveCssImports`).
// `written` dedups by source (component-imports-component + diamond imports share one module) AND
// guards import cycles (registered before recursing). Returns the emitted module's basename; `files`
// accumulates every written path (the SSR path cleans them up).
async function emitTree(
    source: string,
    dir: string | undefined,
    side: 'client' | 'server',
    resolve: TreeResolver | undefined,
    written: Map<string, string>,
    files: string[],
    target: EmitTarget,
): Promise<string> {
    // Dedup + cycle guard by `dir + source` — the same file (identical source AND dir) shares one temp
    // module; a component-imports-component cycle re-enters with the same key and short-circuits.
    const key = `${dir ?? ''} ${source}`
    const cached = written.get(key)
    if (cached !== undefined) return cached

    const emitted = emitModuleSource(source, dir)
    let src = side === 'client' ? emitted.client : emitted.server
    if (target.siblingRuntime) {
        const runtimeFrom =
            side === 'client' ? '"abide/ui/internal/runtime"' : '"abide/ui/internal/serverRuntime"'
        const runtimeTo = side === 'client' ? '"./runtime.ts"' : '"./serverRuntime.ts"'
        src = src.replace(runtimeFrom, runtimeTo)
    }

    // The compiled module is written elsewhere than next to the `.abide`, so an ordinary import
    // ("./util.ts", "@scope/pkg", "$shared/x") would resolve against the wrong base. Rewrite each to an
    // absolute path resolved from the SOURCE's dir before it is written.
    for (const binding of emitted.analysis.moduleImports) {
        const absolute = resolvePassThroughImport(binding.specifier, dir)
        src = src.replaceAll(
            `from ${JSON.stringify(binding.specifier)}`,
            `from ${JSON.stringify(absolute)}`,
        )
    }

    const basename = target.name(key, side)
    written.set(key, basename) // register before recursion (cycle guard)

    for (const componentImport of emitted.analysis.componentImports) {
        if (resolve === undefined) {
            throw new Error(
                `loadEmitted: <${componentImport.local}> imports "${componentImport.specifier}" but no component resolver was provided`,
            )
        }
        const child = await resolve(componentImport.specifier, componentImport.local, dir)
        const childBasename = await emitTree(
            child.source,
            child.dir,
            side,
            resolve,
            written,
            files,
            target,
        )
        src = src.replaceAll(
            `from ${JSON.stringify(componentImport.specifier)}`,
            `from ${JSON.stringify(`./${childBasename}`)}`,
        )
    }

    const file = `${target.outDir}/${basename}`
    await Bun.write(file, src)
    files.push(file)
    return basename
}

// The SSR path's target: throwaway siblings inside abide's internal dir, unique per process.
function temporaryTarget(): EmitTarget {
    return {
        outDir: INTERNAL_DIR,
        siblingRuntime: true,
        name: (_key, side) => `.emit-${process.pid}-${Date.now()}-${counter++}.${side}.ts`,
    }
}

// One page/layout/component's AOT-emitted server module, as `abide compile` wrote it.
export interface EmittedServerFile {
    source: string
    dir: string
    // Absolute path of the emitted `.ts` module (its `render` is the same one SSR would have built).
    file: string
}

// AOT: emit the server module tree for every entry into `outDir` and return where each landed
// (BP1.6). This is what makes a standalone binary possible at all — the SSR path compiles a `.abide`
// by writing a temp module next to abide's runtime and importing it, and a compiled binary can do
// neither (its own directory is the read-only `/$bunfs/root`, and the app's source is not on the
// deploy machine). Emitting the identical modules at build time turns that runtime step into ordinary
// static imports the bundler can follow. Names are content-derived, so the same source always yields
// the same file and the build is reproducible.
export async function emitServerTree(
    entries: { source: string; dir: string }[],
    outDir: string,
): Promise<EmittedServerFile[]> {
    const written = new Map<string, string>()
    const files: string[] = []
    const target: EmitTarget = {
        outDir,
        siblingRuntime: false,
        name: (key) => `abide-${Bun.hash(key).toString(36)}.server.ts`,
    }
    const emitted: EmittedServerFile[] = []
    for (const entry of entries) {
        const basename = await emitTree(
            entry.source,
            entry.dir,
            'server',
            filesystemResolver,
            written,
            files,
            target,
        )
        emitted.push({ source: entry.source, dir: entry.dir, file: `${outDir}/${basename}` })
    }
    return emitted
}

async function instantiateServer(
    source: string,
    dir?: string,
    resolve?: ComponentResolver,
): Promise<EmittedServerModule> {
    refuseRuntimeEmitInBinary(source, dir)
    const files: string[] = []
    const treeResolve = resolve !== undefined ? harnessResolver(resolve) : filesystemResolver
    const target = temporaryTarget()
    const serverBasename = await emitTree(
        source,
        dir,
        'server',
        treeResolve,
        new Map(),
        files,
        target,
    )
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
    const target = temporaryTarget()
    const clientBasename = await emitTree(
        source,
        undefined,
        'client',
        treeResolve,
        new Map(),
        files,
        target,
    )
    const serverBasename = await emitTree(
        source,
        undefined,
        'server',
        treeResolve,
        new Map(),
        files,
        target,
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
