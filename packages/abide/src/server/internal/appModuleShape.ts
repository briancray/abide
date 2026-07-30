// APP MODULE SHAPE — how to read the exports of a project's own modules. One rule, two readers.
//
// `loadApp` reaches these by DISCOVERING a module and dynamically importing it; a compiled binary reaches
// the identical modules as STATIC imports its generated entry already holds. Both comments that used to
// sit on these functions said so outright ("Exported because a `abide compile` binary imports the same
// modules STATICALLY and must read them the same way"; "Split from the import above so a compiled binary
// applies the identical rule") — the concept had been named, it just had no module.
//
// It matters where they live, not only that they are shared. While they sat in `loadApp.ts`, the binary's
// entry imported that module to reach them, and with it the whole discovery graph: `scanAppSources`,
// `deriveSchemas`, the live tsgo pass. Bun tree-shook the unused half away, so nothing was measurably
// wrong — but the binary's floor then rested on a bundler optimisation rather than on its imports, and
// `compiledAppFloor.test.ts` cannot assert a property that only the optimiser holds.
//
// Everything here is a PURE predicate over an already-imported module object: no filesystem, no
// `import()`, nothing a read-only `/$bunfs/root` cannot do.

import type { Socket } from '../socket.ts'
import type { AppConfig } from './appConfig.ts'
import type { AppLifecycle } from './loadApp.ts'
import type { Middleware } from './middleware.ts'
import type { Route } from './router.ts'

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
