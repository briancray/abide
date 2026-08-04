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
import {
    type AppModuleExports,
    appModuleExports,
    isRoute,
    isSocket,
    singleExport,
} from './appModuleShape.ts'
import { type DeriveEntry, deriveSchemas } from './deriveSchema.ts'
import { mergeSchemas } from './mergeSchemas.ts'
import type { AppConfig, Route } from './router.ts'
import { type AppSources, scanAppSources } from './scanAppSources.ts'

// The baked type-derived schema map (§11.5): `abide build` writes it to `dist/schemas.json` so a
// source-less/tsgo-less runtime (`abide start`, a future `compile`/`cli` standalone) merges schemas
// with NO derivation at boot. Route name → its derived input/output JSON Schema.
export interface BakedSchemas {
    [routeName: string]: { input?: JSONSchema; output?: JSONSchema }
}

const BAKED_SCHEMAS_FILE = 'dist/schemas.json'

// THE MODULE REGISTRY IS KEYED ON THE RESOLVED PATH, and nothing evicts it. Every project module below
// is reached through `await import(absolutePath)`, so a SECOND `loadApp` on the same directory in the
// same process gets the identical namespaces and the identical `Route` objects it already had.
//
// That is correct — and free — for every lane that loads once per process (`abide start`, `abide run`,
// `createTestApp`, a compiled binary). It is the whole bug in the one lane that loads twice: `abide dev`'s
// watcher calls `loadApp(dir, { schemas: 'source' })` on every save and then `App.rebind()`s the result.
// The rebuild reported success, the reload signal published, the browser did a full `location.reload()`
// — and the server went on executing the PREVIOUS handler and the PREVIOUS `config.middleware` for the
// rest of the session. Only `.abide` pages and layouts reflected edits, because those are re-read as
// TEXT rather than imported. It defeats `App.rebind()`'s stated purpose (that per-rpc `middleware` /
// `crossOrigin` not be served from a stale build) and contradicts `build-pipeline.md` BP2.4.
//
// A query suffix is what makes the specifier a different registry key. It LEAKS the previous instances —
// nothing can unload an ES module — which is why it is opt-in per call rather than always-on: a dev
// session trades a bounded per-save leak for edits that actually take, and no other lane pays either.
let reloadGeneration = 0

function projectImport(path: string, reload: boolean): Promise<unknown> {
    return import(reload ? `${path}?abide-reload=${reloadGeneration}` : path)
}

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

async function loadRoutes(
    sources: AppSources['rpc'],
    reload: boolean,
): Promise<{ routes: Record<string, Route>; derivationTargets: DeriveEntry[] }> {
    const routes: Record<string, Route> = {}
    const derivationTargets: DeriveEntry[] = []
    for (const { name, path: absolute } of sources) {
        const module = (await projectImport(absolute, reload)) as Record<string, unknown>
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
    schemaSource: 'baked' | 'source',
): Promise<void> {
    if (targets.length === 0) return
    if (Bun.env.ABIDE_DERIVE_SCHEMAS === '0') return
    // `'source'` ignores the bake outright rather than checking it first — see `LoadAppOptions.schemas`.
    const baked = schemaSource === 'baked' ? await readBakedSchemas(dir) : undefined
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
    reload: boolean,
): Promise<Record<string, Socket<unknown>>> {
    const sockets: Record<string, Socket<unknown>> = {}
    for (const { name, path } of sources) {
        const module = (await projectImport(path, reload)) as Record<string, unknown>
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
async function loadAppModule(
    appPath: string | undefined,
    reload: boolean,
): Promise<AppModuleExports> {
    if (appPath === undefined) return { middleware: [], lifecycle: {} }
    return appModuleExports((await projectImport(appPath, reload)) as Record<string, unknown>)
}

// Import `src/server/config.ts` (if present) for its boot-time `env(...)` side effect (CO1). The
// module itself has no export we consume — importing it validates config at load.
async function loadConfig(configPath: string | undefined, reload: boolean): Promise<void> {
    if (configPath === undefined) return
    await projectImport(configPath, reload)
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

export interface LoadAppOptions {
    // WHICH SCHEMA SOURCE OUT-RANKS THE OTHER, stated by the caller instead of inferred from whether a
    // file happens to exist.
    //
    //   'baked'  — a `dist/schemas.json` written by `abide build` is used verbatim, no tsgo at boot.
    //              The production answer: `abide start` and a compiled binary have no source to derive
    //              from and deliberately carry no tsgo. Falls back to live derivation when absent.
    //   'source' — the project's SOURCE is authoritative and any bake is ignored. The answer for every
    //              lane that reads live source, which is `abide build` (it is producing the bake) and
    //              `abide dev` (it exists to reflect edits).
    //
    // This was a single unconditional "prefer the bake if the file is there", with `abide build`
    // deleting the file first as its way of opting out. Nothing else opted out, so in any project that
    // had run `abide build` or `abide compile` once, `abide dev` merged the stale map for the whole
    // session and never re-derived — an edited handler signature kept validating against the old schema
    // in the one lane whose entire job is reflecting edits. A file's existence was standing in for a
    // question only the caller can answer.
    //
    // REQUIRED, for the reason `RouteClass.methods` is: there is then nowhere to not mention it. Making
    // the lane a parameter and leaving it optional put the same silence one level up — it defaulted to
    // `'baked'`, and two callers never said anything (`abide run`, and `createTestApp`'s discovery mode,
    // the lane whose whole claim is "the real app"), so the staleness class the option exists to prevent
    // was still reachable by saying nothing. The doc block above enumerated the lanes it had thought
    // about and named neither of them.
    schemas: 'baked' | 'source'
    // RE-IMPORT the project's modules instead of taking whatever the module registry already holds.
    // Only `abide dev`'s rebuild sets it — see `projectImport` for what it costs and why every
    // load-once lane declines it. Absent means "this process has not loaded this project before",
    // which is true of every caller but that one.
    reload?: boolean
}

// Scan `dir` (a project root) and build the createApp config by importing its modules. Directories
// that don't exist are simply skipped, so partial projects load fine.
export async function loadApp(dir: string, options: LoadAppOptions): Promise<LoadedApp> {
    await seedAppName(dir)
    const sources = await scanAppSources(dir)
    // ONE generation per load, so every module in this pass agrees. Bumping per import would give a
    // route and the `app.ts` that middlewares it two different copies of any module they share.
    const reload = options.reload === true
    if (reload) reloadGeneration++
    await loadConfig(sources.config, reload)

    const { routes, derivationTargets } = await loadRoutes(sources.rpc, reload)
    await applyDerivedSchemas(dir, routes, derivationTargets, options.schemas)
    const sockets = await loadSockets(sources.sockets, reload)
    const pages = await loadPages(sources.pages)
    const layouts = await loadLayouts(sources.layouts)
    const app = await loadAppModule(sources.app, reload)

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
