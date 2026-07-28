// FILE-BASED APP LOADER (M-CLI / CL1-3, BP1-3) — scans a project directory and builds the
// createApp config by IMPORTING the app's modules at runtime (Bun imports .ts directly).
//
// The filesystem is the source of truth (abide-compiler C6): one RPC per file under
// `src/server/rpc/**`, one socket per file under `src/server/sockets/*`, pages under
// `src/ui/pages/**/page.abide`, and the process-lifecycle module at `src/app.ts` (middleware +
// onStart/onStop/onHealth, CL3). `src/server/config.ts` is imported for its boot-time `env(...)`
// side effect (CO1). Missing directories/files are skipped — a project need not have every kind.
//
// Route-name derivation mirrors the URL surface: rpc path under `rpc/` without extension
// (`rpc/user.ts` → "user", `rpc/users/list.ts` → "users/list"); page path from the folder chain
// (`pages/page.abide` → "/", `pages/about/page.abide` → "/about", `pages/users/[id]/page.abide` →
// "/users/[id]"); socket name from the filename stem.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { JSONSchema } from '../../shared/internal/jsonSchema.ts'
import { jsonSchemaOf } from '../../shared/internal/shapeToSchema.ts'
import { log } from '../../shared/log.ts'
import type { Socket } from '../socket.ts'
import { type DeriveEntry, deriveSchemas } from './deriveSchema.ts'
import { layoutRoutePrefix } from './layouts.ts'
import type { Middleware } from './middleware.ts'
import { routePrefixFromRelative } from './routePrefixFromRelative.ts'
import type { AppConfig, Route } from './router.ts'

// The baked type-derived schema map (§11.5): `abide build` writes it to `dist/schemas.json` so a
// source-less/tsgo-less runtime (`abide start`, a future `compile`/`cli` standalone) merges schemas
// with NO derivation at boot. Route name → its derived input/output JSON Schema.
export interface BakedSchemas {
    [routeName: string]: { input?: JSONSchema; output?: JSONSchema }
}

const BAKED_SCHEMAS_FILE = 'dist/schemas.json'

// The process-lifecycle hooks a project's `src/app.ts` may export alongside `middleware` (CL3).
// `onHealth` is NOT here — it is consumed by the router per request, so it rides on `AppConfig`.
//
// Both are WRAPPERS around the real boot/teardown (CL2): each receives a thunk (`start`/`stop`) and
// runs it to proceed. `onStart` may do setup BEFORE calling `start()` — the socket binds only inside
// it — and returning without calling `start()` is a breakout (the app never boots). `onStop` may drain
// before `stop()`; teardown is guaranteed (serve() calls `stop()` as a backstop if the hook doesn't).
export interface AppLifecycle {
    onStart?: (start: () => Promise<void>) => void | Promise<void>
    onStop?: (stop: () => Promise<void>) => void | Promise<void>
}

// What `loadApp` hands back: the router's AppConfig (which now carries `onHealth`) plus the captured
// process-lifecycle hooks. The caller feeds the AppConfig fields to `createApp` and drives
// onStart/onStop itself (CL2/CO2.4); the router drives `onHealth`.
export interface LoadedApp extends AppConfig, AppLifecycle {}

// Pull the single meaningful export from an imported module, WITH the name it was found under (needed
// to derive its schema from source). Prefer `default`, else the sole named export. Returns undefined
// when the module has no usable export (the caller decides to skip it).
function singleExport(
    module: Record<string, unknown>,
): { value: unknown; exportName: string } | undefined {
    if (module.default !== undefined) return { value: module.default, exportName: 'default' }
    const names = Object.keys(module).filter((name) => name !== 'default')
    const only = names[0]
    if (names.length === 1 && only !== undefined) return { value: module[only], exportName: only }
    return undefined
}

// An RPC module's export is an `Rpc`/`Mutation` — both carry non-enumerable `__rpc` metadata.
function isRoute(value: unknown): value is Route {
    return typeof value === 'function' && '__rpc' in (value as object)
}

// A socket module's export is a `Socket` — it carries the `__socket` internals handle. A `Socket` is a
// CALLABLE (`socket({room})` picks a room; ADR 0023), so it is a `function`, not an `object` — accept
// either callable or object as long as it carries `__socket`.
function isSocket(value: unknown): value is Socket<unknown> {
    return (
        (typeof value === 'object' || typeof value === 'function') &&
        value !== null &&
        '__socket' in value
    )
}

// rpc/<a>/<b>.ts → "<a>/<b>". Relative path already POSIX from Bun.Glob; strip the `.ts` suffix.
function rpcRouteName(relativePath: string): string {
    return relativePath.replace(/\.ts$/, '')
}

// pages/**/page.abide → the request path.
function pageRoutePath(relativePath: string): string {
    return routePrefixFromRelative(relativePath, 'page.abide')
}

// sockets/<name>.ts → "<name>".
function socketName(relativePath: string): string {
    return relativePath.replace(/\.ts$/, '')
}

// Enumerate files matching `pattern` under `baseDir`, returning POSIX-relative paths. A missing
// base dir yields nothing (Bun.Glob.scan simply finds no matches).
async function scanFiles(baseDir: string, pattern: string): Promise<string[]> {
    if (!existsSync(baseDir)) return []
    const glob = new Bun.Glob(pattern)
    const found: string[] = []
    for await (const relative of glob.scan({ cwd: baseDir, onlyFiles: true })) {
        found.push(relative)
    }
    found.sort()
    return found
}

async function loadRoutes(
    dir: string,
): Promise<{ routes: Record<string, Route>; derivationTargets: DeriveEntry[] }> {
    const rpcDir = join(dir, 'src/server/rpc')
    const routes: Record<string, Route> = {}
    const derivationTargets: DeriveEntry[] = []
    const files = await scanFiles(rpcDir, '**/*.ts')
    for (const relative of files) {
        const absolute = join(rpcDir, relative)
        const module = (await import(absolute)) as Record<string, unknown>
        const exported = singleExport(module)
        if (exported === undefined || !isRoute(exported.value)) continue
        const name = rpcRouteName(relative)
        routes[name] = exported.value
        // An RPC missing EITHER a hand-written input or output schema is a candidate for type
        // derivation (§11): the handler's arg type → input schema, its return payload → output schema.
        // An explicit schema always wins per field.
        const schemas = exported.value.__rpc.options.schemas
        if (schemas?.input === undefined || schemas?.output === undefined) {
            derivationTargets.push({
                key: name,
                filePath: absolute,
                exportName: exported.exportName,
            })
        }
    }
    return { routes, derivationTargets }
}

// §11 type-derived schemas: fill each RPC's missing `input`/`output` from its handler's TS types.
// Merged into `options.schemas` so the registry (OpenAPI/MCP), the router's input validation, and its
// output drift-check + shaping (§5.2) all pick it up with no further wiring — an explicit schema is
// never overwritten (per field). The schemas come from either a **baked** `dist/schemas.json` (§11.5,
// written by `abide build` — used verbatim, no tsgo at boot) or, when absent, ONE batched live tsgo
// session (~sub-second for a whole app). tsgo-unrepresentable positions (§11.3) derive nothing (a
// logged warning) and stay as-is; output unwraps the response wrapper (§11.4). Opt out with
// `ABIDE_DERIVE_SCHEMAS=0`.
async function applyDerivedSchemas(
    dir: string,
    routes: Record<string, Route>,
    targets: DeriveEntry[],
): Promise<void> {
    if (targets.length === 0) return
    if (Bun.env.ABIDE_DERIVE_SCHEMAS === '0') return
    const baked = await readBakedSchemas(dir)
    // Baked path: no tsgo, no warnings (they were emitted at build). Live path: derive + log warnings.
    const derived = baked ?? (await deriveSchemas(targets))
    for (const target of targets) {
        const result = derived[target.key]
        if (result === undefined) continue
        if (baked === undefined && 'warnings' in result) {
            for (const warning of (result as { warnings: string[] }).warnings) {
                log.channel('abide:rpc').warn(warning)
            }
        }
        const route = routes[target.key]
        if (route === undefined) continue
        const options = route.__rpc.options
        const schemas = { ...options.schemas }
        if (schemas.input === undefined && result.input !== undefined) schemas.input = result.input
        if (schemas.output === undefined && result.output !== undefined) {
            schemas.output = result.output
        }
        options.schemas = schemas
    }
}

// Read the baked schema map if `abide build` wrote one. A missing/corrupt file → live derivation.
async function readBakedSchemas(dir: string): Promise<BakedSchemas | undefined> {
    const path = join(dir, BAKED_SCHEMAS_FILE)
    if (!existsSync(path)) return undefined
    try {
        return (await Bun.file(path).json()) as BakedSchemas
    } catch {
        return undefined
    }
}

// §11.5 build-time bake: project every route's EFFECTIVE input/output schema (derived or explicit, as
// long as it's JSON-Schema-representable — a native Standard Schema like Zod stays in the module and
// needs no baking) into `dist/schemas.json`, so a tsgo-less runtime merges it at boot. Called by
// `abide build` AFTER a live `loadApp` has merged the derived schemas onto the routes.
export async function writeBakedSchemas(dir: string, routes: Record<string, Route>): Promise<void> {
    const baked: BakedSchemas = {}
    for (const [name, route] of Object.entries(routes)) {
        const schemas = route.__rpc.options.schemas
        const input = jsonSchemaOf(schemas?.input)
        const output = jsonSchemaOf(schemas?.output)
        if (input === undefined && output === undefined) continue
        const entry: { input?: JSONSchema; output?: JSONSchema } = {}
        if (input !== undefined) entry.input = input
        if (output !== undefined) entry.output = output
        baked[name] = entry
    }
    await Bun.write(join(dir, BAKED_SCHEMAS_FILE), JSON.stringify(baked, null, 2))
}

async function loadSockets(dir: string): Promise<Record<string, Socket<unknown>>> {
    const socketsDir = join(dir, 'src/server/sockets')
    const sockets: Record<string, Socket<unknown>> = {}
    const files = await scanFiles(socketsDir, '*.ts')
    for (const relative of files) {
        const module = (await import(join(socketsDir, relative))) as Record<string, unknown>
        const exported = singleExport(module)
        if (exported === undefined || !isSocket(exported.value)) continue
        sockets[socketName(relative)] = exported.value
    }
    return sockets
}

async function loadPages(
    dir: string,
): Promise<{ pages: Record<string, string>; dirs: Record<string, string> }> {
    const pagesDir = join(dir, 'src/ui/pages')
    const pages: Record<string, string> = {}
    const dirs: Record<string, string> = {}
    const files = await scanFiles(pagesDir, '**/page.abide')
    for (const relative of files) {
        const absolute = join(pagesDir, relative)
        const source = await Bun.file(absolute).text()
        const route = pageRoutePath(relative)
        pages[route] = source
        // The page's source dir — used to resolve its relative CSS imports in the client bundle (TODO #20).
        dirs[route] = dirname(absolute)
    }
    return { pages, dirs }
}

// pages/**/layout.abide → the directory route prefix it wraps (TODO #7). Keyed by prefix so the
// composer can select a page's applicable layouts (root → nearest). Sits alongside the page scan.
async function loadLayouts(
    dir: string,
): Promise<{ layouts: Record<string, string>; dirs: Record<string, string> }> {
    const pagesDir = join(dir, 'src/ui/pages')
    const layouts: Record<string, string> = {}
    const dirs: Record<string, string> = {}
    const files = await scanFiles(pagesDir, '**/layout.abide')
    for (const relative of files) {
        const absolute = join(pagesDir, relative)
        const source = await Bun.file(absolute).text()
        const prefix = layoutRoutePrefix(relative)
        layouts[prefix] = source
        dirs[prefix] = dirname(absolute)
    }
    return { layouts, dirs }
}

// Import `src/app.ts` (if present) for its middleware array + lifecycle hooks. A middleware export
// that isn't an array is ignored (defensive); each hook is carried only when it is a function.
async function loadAppModule(dir: string): Promise<{
    middleware: Middleware[]
    lifecycle: AppLifecycle
    onHealth?: AppConfig['onHealth']
    onError?: AppConfig['onError']
}> {
    const appPath = join(dir, 'src/app.ts')
    if (!(await Bun.file(appPath).exists())) return { middleware: [], lifecycle: {} }

    const module = (await import(appPath)) as Record<string, unknown>
    const middleware = Array.isArray(module.middleware) ? (module.middleware as Middleware[]) : []
    const lifecycle: AppLifecycle = {}
    if (typeof module.onStart === 'function')
        lifecycle.onStart = module.onStart as (start: () => Promise<void>) => void | Promise<void>
    if (typeof module.onStop === 'function')
        lifecycle.onStop = module.onStop as (stop: () => Promise<void>) => void | Promise<void>
    // onHealth/onError ride on AppConfig (router-consumed per request), not AppLifecycle.
    const result: {
        middleware: Middleware[]
        lifecycle: AppLifecycle
        onHealth?: AppConfig['onHealth']
        onError?: AppConfig['onError']
    } = { middleware, lifecycle }
    if (typeof module.onHealth === 'function')
        result.onHealth = module.onHealth as AppConfig['onHealth']
    if (typeof module.onError === 'function')
        result.onError = module.onError as AppConfig['onError']
    return result
}

// Import `src/server/config.ts` (if present) for its boot-time `env(...)` side effect (CO1). The
// module itself has no export we consume — importing it validates config at load.
async function loadConfig(dir: string): Promise<void> {
    const configPath = join(dir, 'src/server/config.ts')
    if (!(await Bun.file(configPath).exists())) return
    await import(configPath)
}

// Seed the default log channel (CO2.2) from the project's package.json `name`, so `log(...)` lines
// are labeled with the app name rather than the "abide" fallback. An explicit `ABIDE_APP_NAME`
// wins (operator override); a missing/nameless package.json leaves the fallback in place.
async function seedAppName(dir: string): Promise<void> {
    if (process.env.ABIDE_APP_NAME !== undefined && process.env.ABIDE_APP_NAME.length > 0) return
    const pkgFile = Bun.file(join(dir, 'package.json'))
    if (!(await pkgFile.exists())) return
    try {
        const pkg = (await pkgFile.json()) as { name?: unknown }
        if (typeof pkg.name === 'string' && pkg.name.length > 0) {
            process.env.ABIDE_APP_NAME = pkg.name
        }
    } catch {
        // A malformed package.json is not fatal to boot — keep the "abide" fallback label.
    }
}

// Scan `dir` (a project root) and build the createApp config by importing its modules. Directories
// that don't exist are simply skipped, so partial projects load fine.
export async function loadApp(dir: string): Promise<LoadedApp> {
    await seedAppName(dir)
    await loadConfig(dir)

    const { routes, derivationTargets } = await loadRoutes(dir)
    await applyDerivedSchemas(dir, routes, derivationTargets)
    const sockets = await loadSockets(dir)
    const pages = await loadPages(dir)
    const layouts = await loadLayouts(dir)
    const app = await loadAppModule(dir)

    const loaded: LoadedApp = {
        dir,
        routes,
        sockets,
        pages: pages.pages,
        pageDirs: pages.dirs,
        layouts: layouts.layouts,
        layoutDirs: layouts.dirs,
        middleware: app.middleware,
    }
    if (app.lifecycle.onStart !== undefined) loaded.onStart = app.lifecycle.onStart
    if (app.lifecycle.onStop !== undefined) loaded.onStop = app.lifecycle.onStop
    if (app.onHealth !== undefined) loaded.onHealth = app.onHealth
    if (app.onError !== undefined) loaded.onError = app.onError
    return loaded
}
