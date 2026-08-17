// The server half of `health()`: a baseline abide fills in, and the app's own account merged over it.
//
// The baseline exists so that an app which reported nothing still answers something a monitor can
// read — a version to correlate a deploy by, and a start time to tell a restart from a hang. The
// merge is the app's, and it wins every field, because the framework's four are a floor rather than
// a claim about the app's own dependencies.
//
// A reporter that THROWS is the case worth being deliberate about. It is an app saying it is not
// working, which is an account rather than an accident, so it does not escape as a throw: the
// document keeps the baseline, gains the failure under `error`, and the endpoint answers 503 off
// that one field. The failure is also written to `abide:health` as a warning, which the `DEBUG` gate
// never swallows — the gate is there to control volume, not to hide breakage.

import { type Health, useHealthSource } from '$shared/health.ts'
import { isThenable } from '$shared/internal/probes.ts'
import { abideLog } from '$shared/log.ts'
import { appVersion } from './app.ts'
import { NO_STORE } from './internal/CACHE.ts'
import { HookSlot } from './internal/hooks.ts'
import { failedInto, merged } from './internal/merge.ts'
import { json, refuse } from './responses.ts'

const healthLog = abideLog.channel('health')

/** What an app's `onHealth` is: fields to merge. A promise is one of the things it may return. */
export type HealthReporter = () => unknown

// One app, one account, so a second registration REPLACES the first rather than being merged with
// it: two reporters answering the same question would need an order, and an order nobody declared is
// one the import graph decides.
const REPORTER = new HookSlot<HealthReporter>()

/**
 * The app's own account of whether it is working.
 *
 * Returns the way back. The registration is the primitive: an app that exports `onHealth` has that
 * export handed here by the CLI's `HOOKS` table, and calling this directly is the same thing said at
 * module scope — while a hook that cannot be taken off again is one a test cannot register twice.
 */
export function onHealth(report: HealthReporter): () => void {
    return REPORTER.set(report)
}

/**
 * When the PROCESS started, rather than when this module was imported.
 *
 * `performance.timeOrigin` is that instant on the epoch and `performance.now()` counts from it, so
 * the two fields below cannot disagree — and `uptime` is monotonic, which a subtraction of two
 * `Date.now()` readings is not: an NTP correction would otherwise show a process going backwards.
 */
const ORIGIN =
    Number.isFinite(performance.timeOrigin) && performance.timeOrigin > 0
        ? performance.timeOrigin
        : Date.now() - performance.now()
const STARTED_AT = new Date(ORIGIN).toISOString()

function baseline(): Health {
    return {
        reachable: true,
        version: appVersion(),
        startedAt: STARTED_AT,
        uptime: Math.round(performance.now()),
    }
}

/**
 * The whole document.
 *
 * Guarded rather than awaited, like every other hook on this path: the ordinary app has no reporter
 * at all, and an unconditional await would cost a promise and a tick to learn that.
 */
function compose(): Health | Promise<Health> {
    const report = REPORTER.held
    if (report === null) return baseline()
    let reported: unknown
    try {
        reported = report()
    } catch (failure) {
        return failing(failure)
    }
    if (!isThenable(reported)) return over(reported)
    return (reported as Promise<unknown>).then(over, failing)
}

/**
 * The app's fields over the baseline, including the four abide fills in: an app that knows its own
 * version — a build stamp rather than a manifest — is telling us something the climb cannot.
 */
function over(reported: unknown): Health {
    return merged(baseline(), reported, healthLog, 'what onHealth returned')
}

function failing(failure: unknown): Health {
    return failedInto(baseline(), failure, healthLog, 'onHealth')
}

useHealthSource(compose)

// --- the endpoint ------------------------------------------------------------

/**
 * `GET /__abide/health`.
 *
 * Open, like the schema catalogue and unlike the log feed: a health check an operator has to
 * configure a secret into is one that is not wired up on the day it matters, and what it publishes is
 * a version, an uptime and whatever the app itself chose to say.
 */
export function serveHealth(request: Request): Response | Promise<Response> {
    if (request.method !== 'GET') return refuse('health is a GET', 405)
    const composed = compose()
    return isThenable(composed) ? composed.then(answer) : answer(composed)
}

/**
 * 503 off the document's own `error` field rather than off a flag beside it — an app that puts one
 * there deliberately is saying the same thing the thrown reporter said, and one rule answers both.
 */
function answer(document: Health): Response {
    // `no-store` is the whole point of this answer: it describes this process at this moment, and a
    // cached one is a load balancer being told a drained instance is healthy — the one failure a
    // health check exists to prevent.
    const init: ResponseInit = { headers: { 'cache-control': NO_STORE } }
    if (document.error !== undefined) init.status = 503
    return json(document, init)
}
