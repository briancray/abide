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
import { join } from 'node:path'
import type { JSONSchema } from '../../shared/internal/jsonSchema.ts'
import { jsonSchemaOf } from '../../shared/internal/shapeToSchema.ts'
import { log } from '../../shared/log.ts'
import type { Socket } from '../socket.ts'
import { type DeriveEntry, deriveSchemas } from './deriveSchema.ts'
import { mergeSchemas } from './mergeSchemas.ts'
import type { Middleware } from './middleware.ts'
import type { AppConfig, Route } from './router.ts'
import { type AppSources, scanAppSources } from './scanAppSources.ts'

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
//
// Exported because a `abide compile` binary imports the same modules STATICALLY and must read them the
// same way: what counts as "the RPC in this file" is one rule, and a second copy of it in the code
// generator would be a rule two surfaces could disagree about.
export function singleExport(
    module: Record<string, unknown>,
): { value: unknown; exportName: string } | undefined {
    if (module.default !== undefined) return { value: module.default, exportName: 'default' }
    const names = Object.keys(module).filter((name) => name !== 'default')
    const only = names[0]
    if (names.length === 1 && only !== undefined) return { value: module[only], exportName: only }
    return undefined
}

// An RPC module's export is an `Rpc`/`Mutation` — both carry non-enumerable `__rpc` metadata.
export function isRoute(value: unknown): value is Route {
    return typeof value === 'function' && '__rpc' in (value as object)
}

// A socket module's export is a `Socket` — it carries the `__socket` internals handle. A `Socket` is a
// CALLABLE (`socket({room})` picks a room; ADR 0023), so it is a `function`, not an `object` — accept
// either callable or object as long as it carries `__socket`.
export function isSocket(value: unknown): value is Socket<unknown> {
    return (
        (typeof value === 'object' || typeof value === 'function') &&
        value !== null &&
        '__socket' in value
    )
}

async function loadRoutes(
    sources: AppSources['rpc'],
): Promise<{ routes: Record<string, Route>; derivationTargets: DeriveEntry[] }> {
    const routes: Record<string, Route> = {}
    const derivationTargets: DeriveEntry[] = []
    for (const { name, path: absolute } of sources) {
        const module = (await import(absolute)) as Record<string, unknown>
        const exported = singleExport(module)
        if (exported === undefined || !isRoute(exported.value)) continue
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
    if (baked === undefined) {
        for (const target of targets) {
            const result = derived[target.key]
            if (result === undefined || !('warnings' in result)) continue
            for (const warning of (result as { warnings: string[] }).warnings) {
                log.channel('abide:rpc').warn(warning)
            }
        }
    }
    mergeSchemas(routes, derived)
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

async function loadSockets(
    sources: AppSources['sockets'],
): Promise<Record<string, Socket<unknown>>> {
    const sockets: Record<string, Socket<unknown>> = {}
    for (const { name, path } of sources) {
        const module = (await import(path)) as Record<string, unknown>
        const exported = singleExport(module)
        if (exported === undefined || !isSocket(exported.value)) continue
        sockets[name] = exported.value
    }
    return sockets
}

async function loadPages(
    sources: AppSources['pages'],
): Promise<{ pages: Record<string, string>; dirs: Record<string, string> }> {
    const pages: Record<string, string> = {}
    const dirs: Record<string, string> = {}
    for (const { route, path, dir } of sources) {
        pages[route] = await Bun.file(path).text()
        // The page's source dir — used to resolve its relative CSS imports in the client bundle (TODO #20).
        dirs[route] = dir
    }
    return { pages, dirs }
}

// pages/**/layout.abide → the directory route prefix it wraps (TODO #7). Keyed by prefix so the
// composer can select a page's applicable layouts (root → nearest). Sits alongside the page scan.
async function loadLayouts(
    sources: AppSources['layouts'],
): Promise<{ layouts: Record<string, string>; dirs: Record<string, string> }> {
    const layouts: Record<string, string> = {}
    const dirs: Record<string, string> = {}
    for (const { prefix, path, dir } of sources) {
        layouts[prefix] = await Bun.file(path).text()
        dirs[prefix] = dir
    }
    return { layouts, dirs }
}

// Import `src/app.ts` (if present) for its middleware array + lifecycle hooks.
async function loadAppModule(appPath: string | undefined): Promise<AppModuleExports> {
    if (appPath === undefined) return { middleware: [], lifecycle: {} }
    return appModuleExports((await import(appPath)) as Record<string, unknown>)
}

export interface AppModuleExports {
    middleware: Middleware[]
    lifecycle: AppLifecycle
    onHealth?: AppConfig['onHealth']
    onError?: AppConfig['onError']
}

// Read a project's `src/app.ts` module object (CL3). A middleware export that isn't an array is ignored
// (defensive); each hook is carried only when it is a function. Split from the import above so a
// compiled binary, which has the module as a static import, applies the identical rule.
export function appModuleExports(module: Record<string, unknown>): AppModuleExports {
    const middleware = Array.isArray(module.middleware) ? (module.middleware as Middleware[]) : []
    const lifecycle: AppLifecycle = {}
    if (typeof module.onStart === 'function')
        lifecycle.onStart = module.onStart as (start: () => Promise<void>) => void | Promise<void>
    if (typeof module.onStop === 'function')
        lifecycle.onStop = module.onStop as (stop: () => Promise<void>) => void | Promise<void>
    // onHealth/onError ride on AppConfig (router-consumed per request), not AppLifecycle.
    const result: AppModuleExports = { middleware, lifecycle }
    if (typeof module.onHealth === 'function')
        result.onHealth = module.onHealth as AppConfig['onHealth']
    if (typeof module.onError === 'function')
        result.onError = module.onError as AppConfig['onError']
    return result
}

// Import `src/server/config.ts` (if present) for its boot-time `env(...)` side effect (CO1). The
// module itself has no export we consume — importing it validates config at load.
async function loadConfig(configPath: string | undefined): Promise<void> {
    if (configPath === undefined) return
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
    const sources = await scanAppSources(dir)
    await loadConfig(sources.config)

    const { routes, derivationTargets } = await loadRoutes(sources.rpc)
    await applyDerivedSchemas(dir, routes, derivationTargets)
    const sockets = await loadSockets(sources.sockets)
    const pages = await loadPages(sources.pages)
    const layouts = await loadLayouts(sources.layouts)
    const app = await loadAppModule(sources.app)

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
