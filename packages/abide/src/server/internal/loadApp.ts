// FILE-BASED APP LOADER (M-CLI / CL1-3, BP1-3) — scans a project directory and builds the
// createApp config by IMPORTING the app's modules at runtime (Bun imports .ts directly).
//
// The filesystem is the source of truth (abide-compiler C6): one RPC per file under
// `src/server/rpc/**`, one socket per file under `src/server/sockets/*`, pages under
// `src/ui/pages/**/page.abide`, and the process-lifecycle module at `src/app.ts` (middleware +
// onStart/onStop/health, CL3). `src/server/config.ts` is imported for its boot-time `env(...)`
// side effect (CO1). Missing directories/files are skipped — a project need not have every kind.
//
// Route-name derivation mirrors the URL surface: rpc path under `rpc/` without extension
// (`rpc/user.ts` → "user", `rpc/users/list.ts` → "users/list"); page path from the folder chain
// (`pages/page.abide` → "/", `pages/about/page.abide` → "/about", `pages/users/[id]/page.abide` →
// "/users/[id]"); socket name from the filename stem.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Socket } from '../socket.ts'
import { layoutRoutePrefix } from './layouts.ts'
import type { Middleware } from './middleware.ts'
import { routePrefixFromRelative } from './routePrefixFromRelative.ts'
import type { AppConfig, Route } from './router.ts'

// The process-lifecycle hooks a project's `src/app.ts` may export alongside `middleware` (CL3).
export interface AppLifecycle {
    onStart?: () => void | Promise<void>
    onStop?: () => void | Promise<void>
    health?: () => unknown | Promise<unknown>
}

// What `loadApp` hands back: the router's AppConfig plus the captured lifecycle hooks. The caller
// feeds the AppConfig fields to `createApp` and drives onStart/onStop/health itself (CL2/CO2.4).
export interface LoadedApp extends AppConfig, AppLifecycle {}

// Pull the single meaningful export from an imported module: prefer `default`, else the sole named
// export. Returns undefined when the module has no usable export (the caller decides to skip it).
function singleExport(module: Record<string, unknown>): unknown {
    if (module.default !== undefined) return module.default
    const names = Object.keys(module).filter((name) => name !== 'default')
    const only = names[0]
    if (names.length === 1 && only !== undefined) return module[only]
    return undefined
}

// An RPC module's export is an `Rpc`/`Mutation` — both carry non-enumerable `__rpc` metadata.
function isRoute(value: unknown): value is Route {
    return typeof value === 'function' && '__rpc' in (value as object)
}

// A socket module's export is a `Socket` — it carries the `__socket` internals handle.
function isSocket(value: unknown): value is Socket<unknown> {
    return typeof value === 'object' && value !== null && '__socket' in value
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

async function loadRoutes(dir: string): Promise<Record<string, Route>> {
    const rpcDir = join(dir, 'src/server/rpc')
    const routes: Record<string, Route> = {}
    const files = await scanFiles(rpcDir, '**/*.ts')
    for (const relative of files) {
        const module = (await import(join(rpcDir, relative))) as Record<string, unknown>
        const exported = singleExport(module)
        if (!isRoute(exported)) continue
        routes[rpcRouteName(relative)] = exported
    }
    return routes
}

async function loadSockets(dir: string): Promise<Record<string, Socket<unknown>>> {
    const socketsDir = join(dir, 'src/server/sockets')
    const sockets: Record<string, Socket<unknown>> = {}
    const files = await scanFiles(socketsDir, '*.ts')
    for (const relative of files) {
        const module = (await import(join(socketsDir, relative))) as Record<string, unknown>
        const exported = singleExport(module)
        if (!isSocket(exported)) continue
        sockets[socketName(relative)] = exported
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
async function loadAppModule(
    dir: string,
): Promise<{ middleware: Middleware[]; lifecycle: AppLifecycle }> {
    const appPath = join(dir, 'src/app.ts')
    if (!(await Bun.file(appPath).exists())) return { middleware: [], lifecycle: {} }

    const module = (await import(appPath)) as Record<string, unknown>
    const middleware = Array.isArray(module.middleware) ? (module.middleware as Middleware[]) : []
    const lifecycle: AppLifecycle = {}
    if (typeof module.onStart === 'function')
        lifecycle.onStart = module.onStart as () => void | Promise<void>
    if (typeof module.onStop === 'function')
        lifecycle.onStop = module.onStop as () => void | Promise<void>
    if (typeof module.health === 'function')
        lifecycle.health = module.health as () => unknown | Promise<unknown>
    return { middleware, lifecycle }
}

// Import `src/server/config.ts` (if present) for its boot-time `env(...)` side effect (CO1). The
// module itself has no export we consume — importing it validates config at load.
async function loadConfig(dir: string): Promise<void> {
    const configPath = join(dir, 'src/server/config.ts')
    if (!(await Bun.file(configPath).exists())) return
    await import(configPath)
}

// Scan `dir` (a project root) and build the createApp config by importing its modules. Directories
// that don't exist are simply skipped, so partial projects load fine.
export async function loadApp(dir: string): Promise<LoadedApp> {
    await loadConfig(dir)

    const routes = await loadRoutes(dir)
    const sockets = await loadSockets(dir)
    const pages = await loadPages(dir)
    const layouts = await loadLayouts(dir)
    const app = await loadAppModule(dir)

    const loaded: LoadedApp = {
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
    if (app.lifecycle.health !== undefined) loaded.health = app.lifecycle.health
    return loaded
}
