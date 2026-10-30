// SECTION 37 — THE LIFECYCLE HOOKS, called from a `.abide`'s `<script server>` or a handler file
// rather than exported from it (37.1). Each call files its function here, at the ROUTE of the file that
// called it, and hands back what unfiles it; `createApp` reads what is filed once every module
// holding a server block has run.
//
// WHICH ROUTE IS ASKED OF THE MODULE BEING EVALUATED, not of the hook: the compiled server module
// calls `fileRoute` with its route before its server block's body and with `undefined` after it,
// and a server block cannot await at its top level (34.3), so the window is synchronous. A hook
// called outside every server block — a test, a script — files at the root.
//
// PROCESS-WIDE, like the modules that call them: each is evaluated once per process, so a second
// `App` in it boots under the same hooks (42.12's sharing, from the other side).

import { type Failed, isFailed } from '#shared/Failed.ts'
import { namedLogger } from '#shared/log.ts'
import type { Middleware } from '#shared/Middleware.ts'
import { aborted, refuse } from '#shared/refuse.ts'
import {
    coversRoute,
    parseRoutePattern,
    type Segment,
} from '#shared/routePattern.ts'
import type { Schema } from '#shared/Schema.ts'

import { config } from './config.ts'
import type { LauncherOptions } from './launcherOptions.ts'
import { currentRequestScope } from './requestScope.ts'

export type AppRung = Middleware<{ request: Request }, Response>

export type Env = Record<string, string | undefined>
export type ConfigDefaults = (env: Env) => unknown
export type ConfigOptions = { schema?: Schema<unknown> }

type Wrapper = (inner: () => Promise<void>) => void | Promise<void>

/** One hook, at the route of the file that filed it. 37.1. */
type Filed<T> = {
    route: string
    segments: Segment[]
    item: T
}

/** Everything the lifecycle hooks filed, for `createApp` to read once the app's modules have run. */
export const HOOKS = {
    rungs: [] as Filed<AppRung>[],
    starts: [] as Filed<Wrapper>[],
    stops: [] as Filed<Wrapper>[],
    errors: [] as Filed<(error: unknown) => unknown>[],
    health: [] as Filed<() => unknown>[],
    config: [] as Filed<{
        defaults: ConfigDefaults | null
        options: ConfigOptions | undefined
    }>[],
    principal: [] as Filed<(claims: unknown) => unknown | Promise<unknown>>[],
    launcher: [] as Filed<() => LauncherOptions>[],
}

const ROOT = '/'

// The route a hook called now is filed at — the server block or handler file being evaluated, or
// the root.
let filing: string | undefined

/**
 * Sets the route the hooks called next are filed at, or the root again for `undefined`.
 *
 * 37.1 — what a compiled server module calls around its `<script server>`, and the plugin around a
 * handler file; nothing an app writes.
 */
export function fileRoute(route: string | undefined): void {
    filing = route
}

const LIFECYCLE_LOG = namedLogger('abide:lifecycle')

function filed<T>(list: Filed<T>[], item: T): () => void {
    const route = filing ?? ROOT
    const entry: Filed<T> = {
        route,
        segments: parseRoutePattern(route),
        item,
    }
    list.push(entry)
    // 37.7 — by route depth, then by route, then in the order called: kept sorted as it is filed,
    // so a reader walks it in order and sorts nothing per request. The sort is stable and the
    // entry lands last, so a tie stays in the order called.
    list.sort(byRoute)
    return () => {
        const at = list.indexOf(entry)
        if (at !== -1) list.splice(at, 1)
    }
}

function byRoute(one: Filed<unknown>, two: Filed<unknown>): number {
    if (one.segments.length !== two.segments.length)
        return one.segments.length - two.segments.length
    if (one.route !== two.route) return one.route < two.route ? -1 : 1
    return 0
}

/** What `list` filed, in 37.7's order. */
export function inOrder<T>(list: readonly Filed<T>[]): T[] {
    const items: T[] = []
    for (const entry of list) items.push(entry.item)
    return items
}

/** The rungs filed at the root route, which run before routing. 37.3. */
export function rootRungs(): AppRung[] {
    const rungs: AppRung[] = []
    for (const entry of HOOKS.rungs)
        if (entry.route === ROOT) rungs.push(entry.item)
    return rungs
}

/**
 * The rungs filed below the root over `route`, outermost first.
 *
 * 37.2 — every rung filed at `route` or at a route that is its front, the root's aside: those ran
 * before routing (37.3).
 */
export function rungsOver(route: string): AppRung[] {
    const segments = parseRoutePattern(route)
    const rungs: AppRung[] = []
    for (const entry of HOOKS.rungs)
        if (entry.route !== ROOT && coversRoute(entry.segments, segments))
            rungs.push(entry.item)
    return rungs
}

/**
 * Files middleware rungs over the calling file's route; returns what unfiles them.
 *
 * 37.3 at the root — pre-routing, over the request and the response, in the order registered. 37.2
 * below it — after routing, over what that route and those below it answer.
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
 * Files a hook handed every unexpected error its route answers; returns what unfiles it.
 *
 * 37.5.
 */
export function onError(fn: (error: unknown) => unknown): () => void {
    return filed(HOOKS.errors, fn)
}

/**
 * Files a health reporter whose account is merged over the baseline; returns what unfiles it.
 *
 * 25.2, 37.7.
 */
export function onHealth(report: () => unknown | Promise<unknown>): () => void {
    return filed(HOOKS.health, report)
}

/**
 * Files config defaults and a schema, composed with every other; returns what unfiles them.
 *
 * 27.6, 37.7 — merged in route order rather than replacing. 27.10 — the read after either is
 * resolved under what is filed now, not what was filed when `config` was last read.
 */
export function onConfig(
    fn: ConfigDefaults | null,
    options?: ConfigOptions,
): () => void {
    const unfile = filed(HOOKS.config, { defaults: fn, options })
    config.invalidate()
    return () => {
        unfile()
        config.invalidate()
    }
}

/**
 * Files a function resolving a principal from its claims, composed with every other; returns what
 * unfiles it.
 *
 * 37.7 — each is handed the claims, and what they answer is merged in route order.
 */
export function onPrincipal(
    resolve: (claims: unknown) => unknown | Promise<unknown>,
): () => void {
    return filed(HOOKS.principal, resolve)
}

/**
 * Files what the desktop app's window and launcher are; returns what unfiles it.
 *
 * 38.80 — called in `src/launcher.abide` alone (38.107), and read as the app launches.
 */
export function onLauncher(options: () => LauncherOptions): () => void {
    return filed(HOOKS.launcher, options)
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
    // 37.5 — NEAREST ROUTE FIRST, over the route the request matched; outside every request, or
    // before one matched, the root's alone.
    const route = currentRequestScope()?.route
    const segments = route === undefined ? undefined : parseRoutePattern(route)
    for (let at = HOOKS.errors.length - 1; at >= 0; at -= 1) {
        const entry = HOOKS.errors[at] as Filed<(error: unknown) => unknown>
        const reaches =
            entry.route === ROOT ||
            (segments !== undefined && coversRoute(entry.segments, segments))
        if (!reaches) continue
        try {
            entry.item(error)
        } catch (thrown) {
            LIFECYCLE_LOG.error('an onError hook threw', thrown)
        }
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
