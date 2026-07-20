// CLIENT BUNDLE BUILDER (M3b, build-pipeline BP1; PR7 AOT client cutover) — the browser JS for a
// page's client mount.
//
// Generates a tiny ENTRY module that imports `bootstrapApp`, plus each page's AOT-emitted client
// `mount` (one temp module per page, keyed by route PATTERN), and the app's RPC specs (name →
// method/read, harvested from the emit analysis's imports). On load the entry registers the page map
// and mounts the page matching `location.pathname`.
//
// PR7: the browser no longer re-parses `.abide` source at runtime. Each page is compiled at build
// time to an ES module via `emitModuleSource(source).client` (`import * as $rt from
// "abide/ui/internal/runtime"` + a lexical `mount($target, $scope)`), written to a temp file, and
// imported by the entry so `Bun.build` resolves the runtime + tree-shakes. Only `runtime.ts` and the
// emitted module strings reach the browser; the build/SSR TS7 modules (`parse.ts`/`analyzeScope.ts`/
// `emit*.ts`) never do — the whole no-eval/CSP win. This is still the module-swap point (rpc-core §6): the page imported real server `Rpc`s during
// SSR; the emitted mount instead reads client fetch proxies over the SAME cell surface off `$scope`
// (built by `bootstrapPage` via `makeClientImports`).
//
// The build is cached per config (a config's pages + routes are fixed for the app's lifetime).
//
// Deferred: per-route code-splitting (one bundle per page) and minification/hashing — BP1 ships a
// single non-minified bundle for the whole app for now.

import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { BunPlugin } from 'bun'
import { analyzeScope, type ScopeAnalysis } from '../../ui/internal/analyzeScope.ts'
import { emitModuleSource } from '../../ui/internal/emit.ts'
import { parse } from '../../ui/internal/parse.ts'
import { applicableLayoutPrefixes } from './layouts.ts'
import { buildRegistry } from './registry.ts'
import type { AppConfig } from './router.ts'

// Absolute path to the bootstrap entry the generated module imports. Resolved from this file's dir
// so Bun.build (running from a temp entry elsewhere) resolves it.
const BOOTSTRAP_PATH = join(import.meta.dir, '../../ui/internal/bootstrap.ts')

// Absolute path to the layout composer (TODO #7). The entry wraps each page's emitted module in its
// layout modules via `compose([...])`, keyed by route pattern.
const COMPOSE_PATH = join(import.meta.dir, '../../ui/internal/compose.ts')

// Absolute path to the client runtime. Emitted client modules import `abide/ui/internal/runtime`; we
// rewrite that bare specifier to this absolute path so the temp modules (written to `tmpdir`, outside
// the package) still resolve the runtime — without polluting the source tree or the dev watcher.
const RUNTIME_PATH = join(import.meta.dir, '../../ui/internal/runtime.ts')

// The built client artifacts: the browser JS bundle and the concatenated CSS (imported `.css`, with
// Tailwind utilities processed when the plugin is available). Cached together per config.
interface ClientArtifacts {
    js: string
    css: string
}

// Cache the built artifacts per config object — an app's pages/routes are fixed for its lifetime.
const BUNDLE_CACHE = new WeakMap<AppConfig, Promise<ClientArtifacts>>()

// Build the RPC specs map (name → { method, read }) the client proxies need. TREE-SHAKING: only the
// RPCs some page actually IMPORTS (by local name matching a route name) are emitted; un-imported RPCs
// never reach the client bundle.
function rpcSpecs(
    config: AppConfig,
    importedNames: Set<string>,
): Record<string, { method: string; read: boolean; shared: boolean }> {
    const specs: Record<string, { method: string; read: boolean; shared: boolean }> = {}
    for (const entry of buildRegistry(config).rpcs) {
        if (!importedNames.has(entry.name)) continue
        specs[entry.name] = { method: entry.method, read: entry.read, shared: entry.shared }
    }
    return specs
}

// The local names a page's `<script>`s import (default/namespace/named), taken from the emit scope
// analysis. Matched against route names to decide which RPC proxies the bundle needs.
function importedLocals(analysis: ScopeAnalysis): Set<string> {
    const names = new Set<string>()
    for (const script of [analysis.module, analysis.instance]) {
        if (script === null) continue
        for (const binding of script.imports) {
            if (binding.defaultLocal !== null) names.add(binding.defaultLocal)
            if (binding.namespaceLocal !== null) names.add(binding.namespaceLocal)
            for (const entry of binding.named) names.add(entry.local)
        }
    }
    return names
}

// One emitted `.abide` client module (a page OR a layout): the temp file holding its `mount`/`hydrate`
// and the import locals harvested for RPC-spec tree-shaking. Deduped by source across the whole app.
interface EmittedModule {
    file: string
    locals: Set<string>
}

// The composed levels for one page: the module indices `[rootLayout, …, nearestLayout, page]` (TODO
// #7), in wrap order. A page with no layouts is a single-index chain (passes straight through compose).
interface PageChain {
    pattern: string
    indices: number[]
}

// Rewrite the emitted client module's RELATIVE side-effect CSS imports (`import "./styles.css"`) to
// absolute paths so `Bun.build` — running from a tmpdir entry outside the source tree — can resolve
// them against the `.abide` file's real source dir. Bare/absolute specifiers are left untouched. When
// no source dir is known (hand-built config), relative specifiers pass through unchanged.
function resolveCssImports(
    client: string,
    cssImports: string[],
    sourceDir: string | undefined,
): string {
    if (sourceDir === undefined) return client
    let out = client
    for (const specifier of cssImports) {
        if (specifier.startsWith('./') || specifier.startsWith('../')) {
            const absolute = join(sourceDir, specifier)
            out = out.replace(
                `import ${JSON.stringify(specifier)};`,
                `import ${JSON.stringify(absolute)};`,
            )
        }
    }
    return out
}

// Pass-through framework imports (`abide/shared/online`, `abide/ui/bundled`, …) are emitted as bare
// `abide/*` specifiers (M3b). Bun.build runs from a tmpdir entry outside the package, so — exactly
// like the runtime specifier above — rewrite each to its absolute path (resolved through abide's own
// package exports) so the temp module resolves it. Deduped across the module's imports.
function resolveModuleImports(client: string, moduleImports: { specifier: string }[]): string {
    let out = client
    const seen = new Set<string>()
    for (const { specifier } of moduleImports) {
        if (seen.has(specifier)) continue
        seen.add(specifier)
        const absolute = Bun.resolveSync(specifier, import.meta.dir)
        out = out.replaceAll(
            `from ${JSON.stringify(specifier)}`,
            `from ${JSON.stringify(absolute)}`,
        )
    }
    return out
}

// Emit one `.abide` source — plus, recursively, every `.abide` component it imports — to temp client
// modules, returning this source's module index. The emitted module imports `abide/ui/internal/runtime`;
// rewrite that to the absolute runtime path so Bun.build resolves it from tmpdir. `sourceDir` (the
// `.abide` file's dir) resolves relative CSS imports AND relative component imports.
//
// Dedup + cycle guard via `visited`: pages/layouts keyed by source, components by absolute path (the
// same file imported by two pages emits once). The temp file + module index are registered BEFORE
// recursing into component imports, so a component-imports-component cycle re-enters and short-circuits.
// Each component import specifier is rewritten to the component's temp module path so `Bun.build`
// follows the whole graph — nested components, per-component CSS, and `<script module>` all handled.
async function emitOne(
    source: string,
    sourceDir: string | undefined,
    visited: Map<string, number>,
    modules: EmittedModule[],
    absolutePath?: string,
): Promise<number> {
    const key = absolutePath !== undefined ? `path:${absolutePath}` : `src:${source}`
    const existing = visited.get(key)
    if (existing !== undefined) return existing

    const analysis = analyzeScope(parse(source))
    const file = join(tmpdir(), `abide-mod-${Bun.randomUUIDv7()}.ts`)
    const index = modules.length
    modules.push({ file, locals: importedLocals(analysis) })
    visited.set(key, index) // register before recursion (cycle guard)

    let client = emitModuleSource(source).client.replace(
        '"abide/ui/internal/runtime"',
        JSON.stringify(RUNTIME_PATH),
    )
    client = resolveCssImports(client, analysis.cssImports, sourceDir)
    client = resolveModuleImports(client, analysis.moduleImports)

    for (const componentImport of analysis.componentImports) {
        if (sourceDir === undefined) {
            throw new Error(
                `abide: <${componentImport.local}> imports "${componentImport.specifier}" but the importer's source dir is unknown (needed to resolve .abide components in the client bundle).`,
            )
        }
        const childPath = join(sourceDir, componentImport.specifier)
        const childSource = await Bun.file(childPath).text()
        const childIndex = await emitOne(
            childSource,
            dirname(childPath),
            visited,
            modules,
            childPath,
        )
        const childModule = modules[childIndex]
        if (childModule === undefined)
            throw new Error(`clientBundle: no module at index ${childIndex}`)
        client = client.replaceAll(
            `from ${JSON.stringify(componentImport.specifier)}`,
            `from ${JSON.stringify(childModule.file)}`,
        )
    }

    await Bun.write(file, client)
    return index
}

// Emit every page + its applicable layouts (deduped), and record each page's composed level chain.
async function emitModules(
    config: AppConfig,
): Promise<{ modules: EmittedModule[]; chains: PageChain[] }> {
    const pages = config.pages ?? {}
    const layouts = config.layouts ?? {}
    const pageDirs = config.pageDirs ?? {}
    const layoutDirs = config.layoutDirs ?? {}
    const visited = new Map<string, number>()
    const modules: EmittedModule[] = []
    const chains: PageChain[] = []
    for (const pattern of Object.keys(pages)) {
        const indices: number[] = []
        for (const prefix of applicableLayoutPrefixes(pattern, layouts)) {
            const layoutSource = layouts[prefix]
            if (layoutSource === undefined)
                throw new Error(`clientBundle: no layout for prefix ${prefix}`)
            indices.push(await emitOne(layoutSource, layoutDirs[prefix], visited, modules))
        }
        const pageSource = pages[pattern]
        if (pageSource === undefined)
            throw new Error(`clientBundle: no page for pattern ${pattern}`)
        indices.push(await emitOne(pageSource, pageDirs[pattern], visited, modules))
        chains.push({ pattern, indices })
    }
    return { modules, chains }
}

// Generate the entry module source: import `bootstrapApp` + `compose` + each unique module's
// `mount`+`hydrate`, then register per-pattern composed page entries (a page wrapped in its layouts,
// outer→inner) and the tree-shaken RPC specs, then bootstrap the app. Keying by pattern lets `[name]`
// param routes resolve on first load and every soft-nav (matchRoute).
function entrySource(modules: EmittedModule[], chains: PageChain[], specsJson: string): string {
    let imports = `import { bootstrapApp } from ${JSON.stringify(BOOTSTRAP_PATH)};\n`
    imports += `import { compose } from ${JSON.stringify(COMPOSE_PATH)};\n`
    let moduleList = ''
    for (const [i, module] of modules.entries()) {
        // Import BOTH the clone `mount` and the attach `hydrate` each emitted module exports. First load
        // and soft-nav go through the composed `hydrate` (bootstrapPage); layers below the root mount via
        // `mount` (positioned by their enclosing `{children()}` component slot).
        imports += `import { mount as $m${i}, hydrate as $h${i} } from ${JSON.stringify(module.file)};\n`
        moduleList += `${moduleList === '' ? '' : ', '}{ mount: $m${i}, hydrate: $h${i} }`
    }
    let entries = ''
    for (const chain of chains) {
        const levels = chain.indices.map((i) => `$MODULES[${i}]`).join(', ')
        entries += `${entries === '' ? '' : ', '}${JSON.stringify(chain.pattern)}: compose([${levels}])`
    }
    return (
        imports +
        `const $MODULES = [ ${moduleList} ];\n` +
        `const PAGES = { ${entries} };\n` +
        `const RPC_SPECS = ${specsJson};\n` +
        `bootstrapApp(PAGES, RPC_SPECS);\n`
    )
}

// The Tailwind Bun.build plugin, loaded lazily so abide never hard-depends on it. When
// `bun-plugin-tailwind` isn't installed, we build WITHOUT it — plain `.css` imports still bundle and
// serve; only `@import "tailwindcss"` utility generation is skipped. Cached (import once per process).
let tailwindPluginPromise: Promise<BunPlugin | null> | undefined
function loadTailwindPlugin(): Promise<BunPlugin | null> {
    if (tailwindPluginPromise === undefined) {
        // Non-literal specifier: the plugin is an OPTIONAL peer (installed by apps that use Tailwind), so
        // abide itself doesn't depend on it — a string variable keeps the type checker from resolving it.
        const specifier = 'bun-plugin-tailwind'
        tailwindPluginPromise = import(specifier)
            .then((mod: { default?: BunPlugin }) => mod.default ?? (mod as unknown as BunPlugin))
            .catch(() => null)
    }
    return tailwindPluginPromise
}

async function build(config: AppConfig): Promise<ClientArtifacts> {
    const { modules, chains } = await emitModules(config)
    const importedNames = new Set<string>()
    for (const mod of modules) for (const local of mod.locals) importedNames.add(local)
    const specsJson = JSON.stringify(rpcSpecs(config, importedNames))

    const entryPath = join(tmpdir(), `abide-client-${Bun.randomUUIDv7()}.ts`)
    await Bun.write(entryPath, entrySource(modules, chains, specsJson))
    try {
        const tailwind = await loadTailwindPlugin()
        // Minify only for an explicit production build (`abide build`/`abide start` set `config.dev =
        // false`). Dev and tests leave `dev` undefined → unminified for fast rebuilds + readable output
        // and stable in-bundle assertions (TODO #6). Per-route splitting/hashing is still deferred.
        const result = await Bun.build({
            entrypoints: [entryPath],
            target: 'browser',
            minify: config.dev === false,
            plugins: tailwind !== null ? [tailwind] : [],
        })
        if (!result.success) {
            const messages = result.logs.map((log) => String(log)).join('\n')
            throw new Error(`abide: client bundle build failed:\n${messages}`)
        }
        // The JS entry output is the `.js`; any imported CSS (including Tailwind-processed utilities) is
        // emitted as separate `.css` asset outputs — concatenate them all into one served stylesheet.
        let js = ''
        let css = ''
        for (const output of result.outputs) {
            if (output.path.endsWith('.css')) css += await output.text()
            else if (output.kind === 'entry-point' || (js === '' && !output.path.endsWith('.css')))
                js = await output.text()
        }
        if (js === '') throw new Error('abide: client bundle produced no JS output.')
        return { js, css }
    } finally {
        await unlink(entryPath).catch(() => {})
        for (const mod of modules) await unlink(mod.file).catch(() => {})
    }
}

function buildArtifacts(config: AppConfig): Promise<ClientArtifacts> {
    let cached = BUNDLE_CACHE.get(config)
    if (cached === undefined) {
        cached = build(config)
        BUNDLE_CACHE.set(config, cached)
    }
    return cached
}

// The browser JS bundle for the app's pages (served at `/__abide/client.js`).
export async function buildClientBundle(config: AppConfig): Promise<string> {
    return (await buildArtifacts(config)).js
}

// The bundled CSS for the app's pages (imported `.css` + processed Tailwind utilities), served at
// `/__abide/client.css`. Empty string when no page imports any CSS.
export async function buildClientCss(config: AppConfig): Promise<string> {
    return (await buildArtifacts(config)).css
}

// Drop the cached bundle for a config so the next `buildClientBundle`/`buildClientCss` rebuilds it.
// The dev watcher calls this after a source change (the config object is mutated in place across
// reloads, so the WeakMap key stays the same and the stale bundle must be evicted explicitly — BP2.4).
export function invalidateClientBundle(config: AppConfig): void {
    BUNDLE_CACHE.delete(config)
}
