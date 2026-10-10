// SECTION 37 — THE LIFECYCLE HOOKS, called from `src/server/app.ts` rather than exported from it
// (37.1). Each call files its function here and hands back what unfiles it; `createApp` reads what
// is filed once the app module has run.
//
// PROCESS-WIDE, like the module that calls them: `app.ts` is evaluated once per process, so a
// second `App` in it boots under the same hooks (42.12's sharing, from the other side).

import { type Failed, isFailed } from '#shared/Failed.ts'
import { namedLogger } from '#shared/log.ts'
import type { Middleware } from '#shared/Middleware.ts'
import { aborted, refuse } from '#shared/refuse.ts'
import type { Schema } from '#shared/Schema.ts'
import { config } from './config.ts'
import { currentRequestScope } from './requestScope.ts'

export type AppRung = Middleware<{ request: Request }, Response>

export type Env = Record<string, string | undefined>
export type ConfigDefaults = (env: Env) => unknown
export type ConfigOptions = { schema?: Schema<unknown> }

type Wrapper = (inner: () => Promise<void>) => void | Promise<void>

/** Everything the lifecycle hooks filed, for `createApp` to read once the app module has run. */
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

/**
 * Files middleware rungs the app runs before routing; returns what unfiles them.
 *
 * 37.3 — pre-routing, over the request and the response, in the order registered.
 */
export function middleware(...rungs: AppRung[]): () => void {
    const unfile: (() => void)[] = []
    for (const rung of rungs) unfile.push(filed(HOOKS.rungs, rung))
    return () => {
        for (const undo of unfile) undo()
    }
}

/**
 * Files a hook wrapping the app's boot; returns what unfiles it.
 *
 * 37.4 — wraps `createApp`. `start` is the boot; a hook that never calls it boots nothing.
 */
export function onStart(
    fn: (start: () => Promise<void>) => void | Promise<void>,
): () => void {
    return filed(HOOKS.starts, fn)
}

/**
 * Files a hook wrapping the app's teardown; returns what unfiles it.
 *
 * 37.4 — wraps `App.stop`'s teardown.
 */
export function onStop(
    fn: (stop: () => Promise<void>) => void | Promise<void>,
): () => void {
    return filed(HOOKS.stops, fn)
}

/**
 * Files a hook handed every unexpected error; returns what unfiles it.
 *
 * 37.5.
 */
export function onError(fn: (error: unknown) => unknown): () => void {
    return filed(HOOKS.errors, fn)
}

/**
 * Files a health reporter whose account is merged over the baseline; returns what unfiles it.
 *
 * 25.2.
 */
export function onHealth(report: () => unknown | Promise<unknown>): () => void {
    return filed(HOOKS.health, report)
}

/**
 * Sets the app's config defaults and schema; returns what unsets them.
 *
 * 27.6, 37.7 — a second replaces the first, schema and all, and says so. 27.10 — the read after
 * either is resolved under what is filed now, not what was filed when `config` was last read.
 */
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
    config.invalidate()
    return () => {
        if (HOOKS.config !== entry) return
        HOOKS.config = undefined
        config.invalidate()
    }
}

/**
 * Sets the function resolving a principal from its claims; returns what unsets it.
 *
 * 37.7 — a second replaces the first, and says so.
 */
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

/**
 * Logs an unexpected error and hands it to every `onError` hook.
 *
 * 37.5 — AN UNEXPECTED ERROR IS ALWAYS WRITTEN, and every `onError` is then handed it. A hook that
 * throws is itself written rather than let loose on the request that was already failing.
 */
export function reportUnexpected(error: unknown): void {
    LIFECYCLE_LOG.error(error)
    handOnError(error)
}

/**
 * Hands an error to every `onError` hook, writing nothing of its own.
 *
 * 12.6 — the half of 37.5 a failure already warned on its own namespace is owed.
 */
export function handOnError(error: unknown): void {
    for (const hook of HOOKS.errors)
        try {
            hook(error)
        } catch (thrown) {
            LIFECYCLE_LOG.error('an onError hook threw', thrown)
        }
}

/**
 * The `Failed` a thrown error answers with: a refusal as it is, anything else a reported 500.
 *
 * 16.40 — a refusal at its own status. 16.41 — anything else is the server's fault, and says
 * nothing about itself to the caller: the log and `onError` get it (37.5).
 *
 * 16.63 — A CLIENT THAT LEFT IS NOT A FAULT: once the request's signal has aborted, what was thrown
 * is the cancellation arriving, so it answers `aborted` and is not reported — a handler's throw and a
 * page render's alike, because both answer here.
 */
export function failureOf(error: unknown): Failed<string, unknown> {
    if (isFailed(error)) return error
    if (currentRequestScope()?.request?.signal.aborted === true)
        return aborted()
    reportUnexpected(error)
    return refuse(500)
}
