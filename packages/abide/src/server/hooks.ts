// SECTION 37 — THE LIFECYCLE HOOKS, called from `src/server/app.ts` rather than exported from it
// (37.1). Each call files its function here and hands back what unfiles it; `createApp` reads what
// is filed once the app module has run.
//
// PROCESS-WIDE, like the module that calls them: `app.ts` is evaluated once per process, so a
// second `App` in it boots under the same hooks (42.12's sharing, from the other side).

import { type Failed, isFailed } from '#shared/Failed.ts'
import { namedLogger } from '#shared/log.ts'
import type { Middleware } from '#shared/Middleware.ts'
import { refuse } from '#shared/refuse.ts'
import type { Schema } from '#shared/Schema.ts'

export type AppRung = Middleware<{ request: Request }, Response>

export type Env = Record<string, string | undefined>
export type ConfigDefaults = (env: Env) => unknown
export type ConfigOptions = { schema?: Schema<unknown> }

type Wrapper = (inner: () => Promise<void>) => void | Promise<void>

export const HOOKS = {
    rungs: [] as AppRung[],
    starts: [] as Wrapper[],
    stops: [] as Wrapper[],
    errors: [] as ((error: unknown) => unknown)[],
    health: [] as (() => unknown)[],
    config: undefined as
        | {
              defaults: ConfigDefaults | null
              options: ConfigOptions | undefined
          }
        | undefined,
    principal: undefined as
        | ((claims: unknown) => unknown | Promise<unknown>)
        | undefined,
}

const LIFECYCLE_LOG = namedLogger('abide:lifecycle')
const CONFIG_LOG = namedLogger('abide:config')
const PRINCIPAL_LOG = namedLogger('abide:principal')

function filed<T>(list: T[], item: T): () => void {
    list.push(item)
    return () => {
        const at = list.indexOf(item)
        if (at !== -1) list.splice(at, 1)
    }
}

// 37.3 — pre-routing, over the request and the response, in the order registered.
export function middleware(...rungs: AppRung[]): () => void {
    const unfile: (() => void)[] = []
    for (const rung of rungs) unfile.push(filed(HOOKS.rungs, rung))
    return () => {
        for (const undo of unfile) undo()
    }
}

// 37.4 — wraps `createApp`. `start` is the boot; a hook that never calls it boots nothing.
export function onStart(
    fn: (start: () => Promise<void>) => void | Promise<void>,
): () => void {
    return filed(HOOKS.starts, fn)
}

// 37.4 — wraps `App.stop`'s teardown.
export function onStop(
    fn: (stop: () => Promise<void>) => void | Promise<void>,
): () => void {
    return filed(HOOKS.stops, fn)
}

// 37.5.
export function onError(fn: (error: unknown) => unknown): () => void {
    return filed(HOOKS.errors, fn)
}

// 25.2 — the app's reporter, merged over the baseline.
export function onHealth(report: () => unknown | Promise<unknown>): () => void {
    return filed(HOOKS.health, report)
}

// 27.6, 37.7 — a second replaces the first, schema and all, and says so.
export function onConfig(
    fn: ConfigDefaults | null,
    options?: ConfigOptions,
): () => void {
    if (HOOKS.config !== undefined)
        CONFIG_LOG.warning(
            'a second onConfig replaced the first, and its schema with it. RULEBOOK 27.6.',
        )
    const entry = { defaults: fn, options }
    HOOKS.config = entry
    return () => {
        if (HOOKS.config === entry) HOOKS.config = undefined
    }
}

// 37.7.
export function onPrincipal(
    resolve: (claims: unknown) => unknown | Promise<unknown>,
): () => void {
    if (HOOKS.principal !== undefined)
        PRINCIPAL_LOG.warning(
            'a second onPrincipal replaced the first. RULEBOOK 37.7.',
        )
    HOOKS.principal = resolve
    return () => {
        if (HOOKS.principal === resolve) HOOKS.principal = undefined
    }
}

// 37.5 — AN UNEXPECTED ERROR IS ALWAYS WRITTEN, and every `onError` is then handed it. A hook that
// throws is itself written rather than let loose on the request that was already failing.
export function reportUnexpected(error: unknown): void {
    LIFECYCLE_LOG.error(error)
    for (const hook of HOOKS.errors)
        try {
            hook(error)
        } catch (thrown) {
            LIFECYCLE_LOG.error('an onError hook threw', thrown)
        }
}

// 16.42 — a refusal at its own status. 16.43 — anything else is the server's fault, and says
// nothing about itself to the caller: the log and `onError` get it (37.5).
export function failureOf(error: unknown): Failed<string, unknown> {
    if (isFailed(error)) return error
    reportUnexpected(error)
    return refuse(500)
}
