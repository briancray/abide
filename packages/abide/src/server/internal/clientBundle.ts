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
// emitted module strings reach the browser; the build/SSR TS7 modules (`parse.ts`/`analyzeBindings.ts`/
// `emit*.ts`) never do — the whole no-eval/CSP win. This is still the module-swap point (rpc-core §6): the page imported real server `Rpc`s during
// SSR; the emitted mount instead reads client fetch proxies over the SAME memo surface off `$scope`
// (built by `bootstrapPage` via `makeClientImports`).
//
// The build is cached per config (a config's pages + routes are fixed for the app's lifetime).
//
// CODE-SPLITTING (TODO #6): the loader entry registers a per-pattern LAZY loader `() => import(chain)`
// instead of statically importing every page. `Bun.build({ splitting: true })` turns each dynamic
// import into its own content-hashed chunk and factors the shared runtime + shared layouts/components
// into shared chunks. First load fetches only the matched route's chunk (+ the shared runtime); a
// soft-nav to an unvisited route lazily imports its chunk. Every output filename embeds a content hash
// (`[hash]` in `naming`) and is served immutable under `/__abide/chunk/` (`publicPath`).

import { mkdir, readdir, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
// Brotli is the one compressor with no Bun API: `Bun.gzipSync`/`Bun.zstdCompressSync` exist, and
// `CompressionStream` accepts gzip/deflate/deflate-raw/zstd but NOT `br`. Since brotli is the encoding
// worth having here (176 KB vs gzip's 209 KB across the docs app's 61 chunks) this is a necessary
// `node:` exception, and it is confined to this build-time path — nothing per-request imports zlib.
import { brotliCompress, constants as zlibConstants } from 'node:zlib'
import type { BunPlugin } from 'bun'
import { appName } from '../../shared/internal/appName.ts'
import { escapeRegExp } from '../../shared/internal/escapeRegExp.ts'
import { type RpcSpec, rpcSpecOf } from '../../shared/internal/rpcSpec.ts'
import { encodeMaxAge, type SocketSpec } from '../../shared/internal/socketSpec.ts'
import { log } from '../../shared/log.ts'
import type { BindingAnalysis } from '../../ui/internal/analyzeBindings.ts'
import { rewriteImportSpecifier } from '../../ui/internal/analyzeBindings.ts'
import { emitModuleSource } from '../../ui/internal/emit.ts'
import { rewriteRuntimeImport } from '../../ui/internal/RUNTIME_IMPORT.ts'
import { resolvePassThroughImport } from '../../ui/internal/resolvePassThroughImport.ts'
import { resolveTemplateAlias } from '../../ui/internal/resolveTemplateAlias.ts'
import { CHUNK_PREFIX } from './CHUNK_PREFIX.ts'
import {
    type ChunkAsset,
    type ClientBuild,
    clientBuildFrom,
    normalizeManifest,
    type StoredClientManifest,
} from './clientArtifact.ts'
import { applicableLayoutPrefixes } from './layouts.ts'
import { buildRegistry, type Clients } from './registry.ts'
import { onRegistryRebind } from './registryDerivation.ts'
import type { AppConfig } from './router.ts'
import { staticAssetType } from './staticAssetType.ts'
import { reaches } from './surfaceProjection.ts'

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

// The artifact's SHAPE and its assembly live in `clientArtifact.ts` — one owner for the in-memory form,
// the on-disk manifest, and the mapping between them. Re-exported here because this is where the build
// that produces them lives, and every existing reader imports them from this module.
export type { ChunkAsset, ClientBuild } from './clientArtifact.ts'

// Below one MTU there is nothing to win: the response already fits in a single segment, so compressing
// it saves no round trip and only adds decode work at both ends.
const MINIMUM_COMPRESSIBLE_BYTES = 512

// Keep an encoding only when it is a REAL win. A build-time compressor knows the exact answer rather
// than estimating it, so the rule is a measurement, not a heuristic: 10% smaller or it is discarded and
// the asset serves identity. This is also what makes a generous `compressible: true` in
// CONTENT_TYPE_BY_EXTENSION safe — a format that turns out not to compress silently drops out here.
// Promisified so the q11 compresses of a build overlap on libuv's threadpool instead of
// serialising on the main thread — see `compressChunk`.
const brotliCompressAsync = promisify(brotliCompress)

const MAXIMUM_COMPRESSED_RATIO = 0.9

const BUNDLE_CACHE = new WeakMap<AppConfig, Promise<ClientBuild>>()

// DERIVED-FROM-THE-REGISTRY (BP2.4): the built client is a projection of `config.routes`/`pages`, and the
// dev loop mutates that config in place, so the WeakMap key never changes and a stale build must be
// evicted explicitly. This used to be a SECOND exported hook (`invalidateClientBundle`) that the dev loop
// called by hand from `cli/`, one line before the `loadApp` whose result made it necessary. Registering
// it puts the eviction next to the cache and makes the dev lane's correctness structural rather than
// conventional — and left that hook with no callers, so it is gone.
onRegistryRebind((config) => {
    BUNDLE_CACHE.delete(config)
})

// Build the RPC specs map (name → { method, read }) the client proxies need. TREE-SHAKING: only the
// RPCs some page actually IMPORTS (by local name matching a route name) are emitted; un-imported RPCs
// never reach the client bundle. REACHABILITY: symmetric with socketSpecs — importing a
// `clients.browser: false` RPC into a UI script is a BUILD ERROR, not a silent inclusion.
function rpcSpecs(config: AppConfig, importedNames: Set<string>): Record<string, RpcSpec> {
    const specs: Record<string, RpcSpec> = {}
    for (const entry of buildRegistry(config).rpcs) {
        if (!importedNames.has(entry.name)) continue
        requireBrowserReachable(entry, 'rpc')
        // The fields that cross, and which of them are written, are `rpcSpec.ts`'s — see `rpcSpecOf`.
        // This used to be a hand-enumerated literal behind an `as` cast, which is the one arrangement
        // that could not catch a field that stopped crossing.
        specs[entry.name] = rpcSpecOf(entry)
    }
    return specs
}

// The same reachability question every surface asks, with a different CONSEQUENCE: elsewhere an
// unreachable callable is skipped, here it is a build ERROR, because the page NAMED it. Skipping would
// ship a page whose import silently resolves to nothing. One statement for both callables — the rpc loop
// and the socket loop had the identical throw with one word different.
function requireBrowserReachable(entry: { name: string; clients: Clients }, kind: string): void {
    if (reaches(entry, 'browser')) return
    throw new Error(
        `abide: ${kind} "${entry.name}" is imported into a UI page but is not browser-reachable (clients.browser: false). Remove the import or expose the ${kind} to the browser.`,
    )
}

// The socket specs the client proxies need (client-sockets.md CS7). TREE-SHAKING: only sockets some
// page IMPORTS reach the bundle. REACHABILITY (CS6.1): importing a `clients.browser: false` socket into
// a UI script is a BUILD ERROR — it has no browser proxy, so a bare `$scope` read would be `undefined`
// at mount; failing loudly at build time is the contract. `maxAge: Infinity` (sticky) serialises to `null`.
function socketSpecs(config: AppConfig, importedNames: Set<string>): Record<string, SocketSpec> {
    const specs: Record<string, SocketSpec> = {}
    for (const entry of buildRegistry(config).sockets) {
        if (!importedNames.has(entry.name)) continue
        requireBrowserReachable(entry, 'socket')
        specs[entry.name] = {
            clientPublish: entry.clientPublish,
            tail: entry.tail,
            maxAge: encodeMaxAge(entry.maxAge),
        }
    }
    return specs
}

// The local names a page's `<script>`s import (default/namespace/named), taken from the emit scope
// analysis. Matched against route names to decide which RPC proxies the bundle needs.
function importedLocals(analysis: BindingAnalysis): Set<string> {
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
    // The applicable layout PREFIXES (outermost→innermost), so the client can compute the shared depth
    // vs the current route and keep the shared layouts alive on a same-chain nav (C6.2).
    prefixes: string[]
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
        const aliased = resolveTemplateAlias(specifier, sourceDir)
        if (aliased !== undefined || specifier.startsWith('./') || specifier.startsWith('../')) {
            const absolute = aliased ?? join(sourceDir, specifier)
            out = out.replace(
                `import ${JSON.stringify(specifier)};`,
                `import ${JSON.stringify(absolute)};`,
            )
        }
    }
    return out
}

// An ordinary `<script>` import (`@scope/pkg`, `$shared/util`, `./helper.ts`, `abide/shared/online`)
// is emitted verbatim by the emitter. Bun.build runs from a tmpdir entry outside the app, so — exactly
// like the runtime specifier above — rewrite each to an absolute path before the temp module is
// written, resolved from the `.abide`'s OWN dir so the app's deps and aliases are in view. Deduped
// across the module's imports.
function resolveModuleImports(
    client: string,
    moduleImports: { specifier: string }[],
    sourceDir: string | undefined,
): string {
    let out = client
    const seen = new Set<string>()
    for (const { specifier } of moduleImports) {
        if (seen.has(specifier)) continue
        seen.add(specifier)
        const absolute = resolvePassThroughImport(specifier, sourceDir)
        out = rewriteImportSpecifier(out, specifier, absolute)
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
    // Dedup key must include `sourceDir`: two byte-identical page/layout sources in DIFFERENT dirs
    // resolve their relative CSS/component imports against different dirs, so keying on source text
    // alone would make the second reuse the first's compiled module (wrong client bundle / hydration
    // mismatch). A component keys by its absolute path (already dir-unique).
    const key =
        absolutePath !== undefined
            ? `path:${absolutePath}`
            : `src:${sourceDir ?? ''}\u0000${source}`
    const existing = visited.get(key)
    if (existing !== undefined) return existing

    const emitted = emitModuleSource(source, sourceDir)
    const analysis = emitted.analysis
    const file = join(tmpdir(), `abide-mod-${Bun.randomUUIDv7()}.ts`)
    const index = modules.length
    modules.push({ file, locals: importedLocals(analysis) })
    visited.set(key, index) // register before recursion (cycle guard)

    let client = rewriteRuntimeImport(emitted.client, 'client', RUNTIME_PATH)
    client = resolveCssImports(client, analysis.cssImports, sourceDir)
    client = resolveModuleImports(client, analysis.moduleImports, sourceDir)

    for (const componentImport of analysis.componentImports) {
        if (sourceDir === undefined) {
            throw new Error(
                `abide: <${componentImport.local}> imports "${componentImport.specifier}" but the importer's source dir is unknown (needed to resolve .abide components in the client bundle).`,
            )
        }
        const childPath =
            resolveTemplateAlias(componentImport.specifier, sourceDir) ??
            join(sourceDir, componentImport.specifier)
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
        const prefixes = applicableLayoutPrefixes(pattern, layouts)
        for (const prefix of prefixes) {
            const layoutSource = layouts[prefix]
            if (layoutSource === undefined)
                throw new Error(`clientBundle: no layout for prefix ${prefix}`)
            indices.push(await emitOne(layoutSource, layoutDirs[prefix], visited, modules))
        }
        const pageSource = pages[pattern]
        if (pageSource === undefined)
            throw new Error(`clientBundle: no page for pattern ${pattern}`)
        indices.push(await emitOne(pageSource, pageDirs[pattern], visited, modules))
        chains.push({ pattern, indices, prefixes })
    }
    return { modules, chains }
}

// A filesystem-safe `[name]` for a route pattern's code-split chunk, so the emitted file is human-
// recognisable (`chain-2-users-id-<hash>.js`). The chain INDEX prefix guarantees uniqueness even when
// two patterns slugify to the same string (`/a-b` vs `/a/b`).
function chainSlug(pattern: string, index: number): string {
    const body = pattern
        .replace(/^\//, '')
        .replace(/[[\]]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    return `chain-${index}-${body === '' ? 'index' : body}`
}

// Generate one page CHAIN module (its own dynamic-import boundary → its own code-split chunk): import
// `compose` + this page's `mount`+`hydrate` and its layouts', then default-export the composed
// (outer→inner) level. `compose` runs INSIDE the chunk so a page's layout modules load with it. Bun's
// splitting factors `compose`/the runtime/shared layouts+components into shared chunks across pages.
function chainSource(chain: PageChain, modules: EmittedModule[]): string {
    let imports = `import { compose } from ${JSON.stringify(COMPOSE_PATH)};\n`
    const levels: string[] = []
    for (const [n, index] of chain.indices.entries()) {
        const module = modules[index]
        if (module === undefined) throw new Error(`clientBundle: no module at index ${index}`)
        // Import BOTH the clone `mount` and the attach `hydrate` each emitted module exports (first load
        // + soft-nav go through `hydrate`; nested layers mount via `mount` from their `{children()}` slot).
        imports += `import { mount as $m${n}, hydrate as $h${n} } from ${JSON.stringify(module.file)};\n`
        levels.push(`{ mount: $m${n}, hydrate: $h${n} }`)
    }
    // Export the composed default (mount/hydrate) PLUS the individual `levels` + layout `prefixes`, so a
    // same-chain soft-nav can compute the shared depth `k` and re-`compose(levels.slice(k))` the diverging
    // suffix into the kept layout's outlet (C6.2), instead of rebuilding the whole tree.
    return (
        `${imports}const $levels = [${levels.join(', ')}];\n` +
        `const $chain = compose($levels);\n` +
        `export default { mount: $chain.mount, hydrate: $chain.hydrate, levels: $levels, prefixes: ${JSON.stringify(chain.prefixes)} };\n`
    )
}

// Generate the loader ENTRY: register a per-pattern LAZY loader (`() => import("<chain>")` — Bun
// rewrites each specifier to its content-hashed chunk URL under `publicPath`), plus the tree-shaken
// RPC specs, then bootstrap the app. Keying by pattern lets `[name]` param routes resolve on first
// load and every soft-nav (matchRoute). Only the matched route's chunk is fetched — the rest stay lazy.
function loaderSource(
    loaders: { pattern: string; file: string }[],
    specsJson: string,
    socketSpecsJson: string,
): string {
    let entries = ''
    for (const { pattern, file } of loaders) {
        entries += `${entries === '' ? '' : ', '}${JSON.stringify(pattern)}: () => import(${JSON.stringify(file)})`
    }
    return (
        `import { bootstrapApp } from ${JSON.stringify(BOOTSTRAP_PATH)};\n` +
        // CO2.2: the app's name, BAKED. A browser has no environment to read it from, and `log` needs
        // it for both the default channel label and the qualification of a bare `log.channel('cards')`
        // → `docs:cards` — un-seeded, the same channel would be `abide:cards` on the client and
        // `docs:cards` on the server. First statement, so it lands before anything can log.
        `globalThis.__ABIDE_APP_NAME__ = ${JSON.stringify(appName())};\n` +
        `const LOADERS = { ${entries} };\n` +
        `const RPC_SPECS = ${specsJson};\n` +
        `const SOCKET_SPECS = ${socketSpecsJson};\n` +
        `bootstrapApp(LOADERS, RPC_SPECS, undefined, SOCKET_SPECS);\n`
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

async function build(config: AppConfig): Promise<ClientBuild> {
    const { modules, chains } = await emitModules(config)
    const importedNames = new Set<string>()
    for (const mod of modules) for (const local of mod.locals) importedNames.add(local)
    const specsJson = JSON.stringify(rpcSpecs(config, importedNames))
    const socketSpecsJson = JSON.stringify(socketSpecs(config, importedNames))

    // Chain modules + the loader entry live in one per-build temp dir so their basenames (`[name]` in
    // the chunk filenames) can be clean + deterministic without a UUID in the served chunk name.
    const buildDir = join(tmpdir(), `abide-build-${Bun.randomUUIDv7()}`)
    await mkdir(buildDir, { recursive: true })
    const loaders: { pattern: string; file: string }[] = []
    const chainSlugs: { pattern: string; slug: string }[] = []
    for (const [i, chain] of chains.entries()) {
        const slug = chainSlug(chain.pattern, i)
        const file = join(buildDir, `${slug}.ts`)
        await Bun.write(file, chainSource(chain, modules))
        loaders.push({ pattern: chain.pattern, file })
        chainSlugs.push({ pattern: chain.pattern, slug })
    }
    const loaderPath = join(buildDir, 'loader.ts')
    await Bun.write(loaderPath, loaderSource(loaders, specsJson, socketSpecsJson))

    try {
        const tailwind = await loadTailwindPlugin()
        const external = await publicExternals(config.dir)
        // Minify only for an explicit production build (`abide build`/`abide start` set `config.dev =
        // false`). Dev and tests leave `dev` undefined → unminified for fast rebuilds + readable output
        // and stable in-bundle assertions. `splitting: true` code-splits each page's chain into its own
        // content-hashed chunk (dynamic-import boundary) + factors the shared runtime into shared chunks;
        // `publicPath` prefixes every chunk URL (static + dynamic) so the router serves them under
        // `/__abide/chunk/`; the `[hash]` in `naming` makes every file content-addressed + immutable.
        const result = await Bun.build({
            entrypoints: [loaderPath],
            target: 'browser',
            splitting: true,
            minify: config.dev === false,
            publicPath: CHUNK_PREFIX,
            naming: {
                entry: '[name]-[hash].[ext]',
                chunk: '[name]-[hash].[ext]',
                asset: '[name]-[hash].[ext]',
            },
            plugins: tailwind !== null ? [tailwind] : [],
            external,
        })
        if (!result.success) {
            const messages = result.logs.map((log) => String(log)).join('\n')
            throw new Error(`abide: client bundle build failed:\n${messages}`)
        }
        // Every `.js` output (loader entry + per-route chunks + shared chunks) is served by filename; any
        // imported CSS (incl. Tailwind-processed utilities) is emitted as separate `.css` asset outputs —
        // concatenated (sorted by path for a stable content hash) into ONE served, hashed stylesheet.
        const identityFiles = new Map<string, Uint8Array<ArrayBuffer>>()
        const cssParts: { path: string; text: string }[] = []
        let entry = ''
        for (const output of result.outputs) {
            const name = basename(output.path)
            if (output.path.endsWith('.css')) {
                cssParts.push({ path: output.path, text: await output.text() })
                continue
            }
            // `arrayBuffer()`, not `bytes()`: a Bun build artifact is typed as a Blob but does not carry
            // Blob's `bytes()` at runtime, and calling it throws mid-build.
            identityFiles.set(name, new Uint8Array(await output.arrayBuffer()))
            if (output.kind === 'entry-point') entry = name
        }
        if (entry === '') throw new Error('abide: client bundle produced no entry output.')
        cssParts.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        const css = cssParts.map((part) => part.text).join('')
        let cssFile: string | undefined
        if (css !== '') {
            const hash = new Bun.CryptoHasher('sha256').update(css).digest('hex').slice(0, 16)
            cssFile = `style-${hash}.css`
            identityFiles.set(cssFile, new TextEncoder().encode(css))
        }
        // Precompress on the SAME condition as minify — an explicit production build. Compression here
        // is affordable precisely because these assets are content-addressed and immutable: the cost is
        // paid once per build and amortised over every request for the life of the hash, which is what
        // buys brotli at its maximum quality. Dev rebuilds skip it (it would be seconds per keystroke
        // for bytes localhost never waits on).
        const compressing = config.dev === false
        // Concurrently: brotli-q11 dominates a production build (measured 590ms of the docs app's
        // 896ms over 61 files) and `brotliCompressSync` runs it on the main thread one file at a time.
        // The async form dispatches to libuv's threadpool, so the files overlap — same bytes out, 4.5x.
        const files = new Map<string, ChunkAsset>()
        const compressed = await Promise.all(
            [...identityFiles].map(async ([name, identity]) => {
                const asset = await compressChunk(name, identity, compressing)
                return [name, asset] as const
            }),
        )
        for (const [name, asset] of compressed) files.set(name, asset)
        // Map each route pattern → its code-split chunk filename (via the chain's unique index-prefixed
        // slug), so the SSR document can `<link rel="modulepreload">` the matched route's chunk and load
        // it in parallel with the loader — eliminating the loader→dynamic-import waterfall on first load.
        const chunkByPattern = new Map<string, string>()
        const names = [...files.keys()]
        for (const { pattern, slug } of chainSlugs) {
            const escaped = escapeRegExp(slug)
            const re = new RegExp(`^${escaped}-[0-9a-z]+\\.js$`)
            const match = names.find((name) => re.test(name))
            if (match !== undefined) chunkByPattern.set(pattern, match)
        }
        return clientBuildFrom({ entry, css: cssFile ?? null, chunkByPattern, files })
    } finally {
        await rm(buildDir, { recursive: true, force: true }).catch(() => {})
        for (const mod of modules) await unlink(mod.file).catch(() => {})
    }
}

// Bun's CSS bundler RESOLVES every `url()` it sees as a module path — a root-absolute
// `url('/fonts/x.woff2')` is a hard build error ("Could not resolve"), and a RELATIVE one is inlined as a
// base64 data URL (at any size — there is no size threshold, and the `loader` option does not apply to
// CSS references). Neither is what a self-hosted font wants: inlining pushes the font's bytes, +33% for
// base64, into the render-blocking stylesheet.
//
// So the public directory defines an EXTERNAL set: each of its top-level entries is marked external, and
// Bun then passes matching `url()`s through verbatim for the `src/ui/public/**` route to serve. Derived
// from the directory rather than a fixed pattern so an unresolvable `url('/typo/x.woff2')` still FAILS
// the build loudly instead of silently emitting a 404-at-runtime reference.
async function publicExternals(dir: string | undefined): Promise<string[]> {
    if (dir === undefined) return []
    let entries: string[]
    try {
        entries = await readdir(join(dir, 'src/ui/public'))
    } catch {
        return [] // No public dir — nothing is external.
    }
    const external: string[] = []
    for (const entry of entries) {
        if (entry.startsWith('.')) continue
        external.push(`/${entry}`, `/${entry}/*`)
    }
    return external
}

// Build one asset's encodings. `compressing` is false for dev/test builds, which serve identity only.
//
// Both compressors run at their MAXIMUM setting, which would be indefensible per-request and is free
// here: the output is keyed by a content hash, so it is computed once and served until the source
// changes. An encoding that fails MAXIMUM_COMPRESSED_RATIO is dropped rather than stored, so the
// serving path never has to ask whether a compressed variant is worth using — if it exists, it won.
async function compressChunk(
    name: string,
    identity: Uint8Array<ArrayBuffer>,
    compressing: boolean,
): Promise<ChunkAsset> {
    if (
        !compressing ||
        identity.byteLength < MINIMUM_COMPRESSIBLE_BYTES ||
        staticAssetType(name)?.compressible !== true
    )
        return { identity, gzip: null, brotli: null }

    const ceiling = identity.byteLength * MAXIMUM_COMPRESSED_RATIO
    // node:zlib returns a `Buffer`, whose type argument is the permissive `ArrayBufferLike`. A Buffer is
    // never SharedArrayBuffer-backed in practice, so narrowing it here is sound and keeps the cast at
    // this one boundary instead of leaking `ArrayBufferLike` into ChunkAsset and every consumer.
    const brotli = (await brotliCompressAsync(identity, {
        params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
            // The encoder sizes its window and its cost model from this; without it a one-shot compress
            // assumes a stream of unknown length and leaves ratio on the table.
            [zlibConstants.BROTLI_PARAM_SIZE_HINT]: identity.byteLength,
        },
    })) as Uint8Array<ArrayBuffer>
    const gzip = Bun.gzipSync(identity, { level: 9 })
    return {
        identity,
        gzip: gzip.byteLength <= ceiling ? gzip : null,
        brotli: brotli.byteLength <= ceiling ? brotli : null,
    }
}

// The file extension each encoding is stored under, beside its identity file in `dist/_app/<hash>/`.
// Sidecars rather than a container format so the build output stays inspectable — `ls` shows exactly
// what a client can be served, and any static file server could host the directory as-is.
export const ENCODING_EXTENSION: Readonly<Record<'gzip' | 'brotli', string>> = {
    gzip: '.gz',
    brotli: '.br',
}

// The content-addressed client build (loader entry + per-route chunks + CSS), cached per config.
export function buildClient(config: AppConfig): Promise<ClientBuild> {
    let cached = BUNDLE_CACHE.get(config)
    if (cached === undefined) {
        cached = build(config)
        BUNDLE_CACHE.set(config, cached)
    }
    return cached
}

// The client build the router serves: a PRE-BUILT one loaded from `dist` (production `abide start` sets
// `config.clientBuild`) when present, else built in-memory (dev/test/first use). Keeps the router blind
// to which path produced it — same `ClientBuild` shape either way.
export function clientBuildFor(config: AppConfig): Promise<ClientBuild> {
    return config.clientBuild !== undefined
        ? Promise.resolve(config.clientBuild)
        : buildClient(config)
}

// Load a pre-built client from `dist/_app/<hash>/` (written by `abide build`) via the stable
// `dist/manifest.json` pointer, so `abide start` serves the exact build output with NO bundler at boot.
// Returns undefined when no build is present (the caller builds instead). Every file is read into memory
// once at boot and served from the same `files` map the in-memory build uses.
//
// "IS THERE A BUILD?" IS ANSWERED BY THE ASSETS, NOT BY THE POINTER ALONE. The manifest's existence used
// to be the whole test, and every file it names was then read unconditionally — so a `dist/` whose
// `manifest.json` outlived its `_app/<hash>/` directory (a deploy that shipped the pointer but pruned or
// partially uploaded the assets, a `rm -rf dist/_app` cleanup) failed `abide start` at boot with a bare
// `ENOENT … loader-abc.js` and no indication that a rebuild was the fix. A manifest pointing at assets
// that are not there means the same thing as no manifest: there is no build, so return undefined and let
// `ensureClientBuild` build one — which is the documented "builds first if absent".
export async function loadClientBuild(dir: string): Promise<ClientBuild | undefined> {
    const manifestFile = Bun.file(join(dir, 'dist', 'manifest.json'))
    if (!(await manifestFile.exists())) return undefined
    // The stored shape has ONE reader, here, and it is normalised at once — the manifest's own type is
    // `clientArtifact.ts`'s, so this cannot be a fourth opinion about which fields are optional.
    const stored = (await manifestFile.json()) as StoredClientManifest & { hash: string }
    const manifest = normalizeManifest(stored)
    const buildDir = join(dir, 'dist', '_app', stored.hash)
    const encodings = manifest.encodings
    // CONCURRENTLY: this is on the critical path of `abide start`, before the port binds, and the reads
    // are independent. Serially it was up to three awaits per file (identity, `.gz`, `.br`) chained
    // end-to-end — ~185 round trips for a 61-chunk build, each waiting on the last for no reason.
    let loaded: [string, ChunkAsset][]
    try {
        loaded = await Promise.all(
            manifest.files.map(async (name): Promise<[string, ChunkAsset]> => {
                const available = encodings[name] ?? []
                const [identity, gzip, brotli] = await Promise.all([
                    Bun.file(join(buildDir, name)).bytes(),
                    available.includes('gzip')
                        ? Bun.file(join(buildDir, name + ENCODING_EXTENSION.gzip)).bytes()
                        : null,
                    available.includes('brotli')
                        ? Bun.file(join(buildDir, name + ENCODING_EXTENSION.brotli)).bytes()
                        : null,
                ])
                return [name, { identity, gzip, brotli }]
            }),
        )
    } catch (caught) {
        // The manifest named assets that are not on disk. Treated as "no build" (see the header) — loud
        // enough to explain the rebuild that follows, not fatal.
        log.channel('abide:bundle').warn(
            `dist/manifest.json points at missing assets in ${buildDir} — rebuilding:`,
            caught instanceof Error ? caught.message : caught,
        )
        return undefined
    }
    const files = new Map<string, ChunkAsset>(loaded)
    return clientBuildFrom({
        entry: manifest.entry,
        css: manifest.css,
        chunkByPattern: manifest.chunkByPattern,
        files,
    })
}
