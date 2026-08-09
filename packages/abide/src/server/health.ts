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
import { errorPayload } from '$shared/internal/wire.ts'
import { abideLog } from '$shared/log.ts'
import { appVersion } from './app.ts'
import { json } from './responses.ts'
import { refuse } from './rpc.ts'

const healthLog = abideLog.channel('health')

/** What an app's `onHealth` is: fields to merge. A promise is one of the things it may return. */
export type HealthReporter = () => unknown

// One app, one account, so a second registration REPLACES the first rather than being merged with
// it: two reporters answering the same question would need an order, and an order nobody declared is
// one the import graph decides.
let reporter: HealthReporter | null = null

/**
 * The app's own account of whether it is working.
 *
 * Returns the way back. The registration is the primitive: an app that exports `onHealth` has that
 * export handed here by the CLI's `HOOKS` table, and calling this directly is the same thing said at
 * module scope — while a hook that cannot be taken off again is one a test cannot register twice.
 */
export function onHealth(report: HealthReporter): () => void {
    reporter = report
    return () => {
        // Only if it is still ours: a later registration already replaced it, and clearing that one
        // would be this disposer reaching past its own hook.
        if (reporter === report) reporter = null
    }
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
    const report = reporter
    if (report === null) return baseline()
    let reported: unknown
    try {
        reported = report()
    } catch (failure) {
        return failing(failure)
    }
    if (!isThenable(reported)) return merged(reported)
    return (reported as Promise<unknown>).then(merged, failing)
}

function merged(reported: unknown): Health {
    const document = baseline()
    if (reported === null || reported === undefined) return document
    if (typeof reported !== 'object' || Array.isArray(reported)) {
        // Nothing to merge, and silently dropping it would leave an app believing it reported
        // something. A warning rather than a throw: the fields are lost either way, and losing the
        // baseline with them helps nobody reading this.
        healthLog.warning(`onHealth returned ${typeof reported}, which has no fields to merge`)
        return document
    }
    // The app's fields win, including the four above: an app that knows its own version — a build
    // stamp rather than a manifest — is telling us something the climb cannot.
    return Object.assign(document, reported)
}

function failing(failure: unknown): Health {
    // The same reduction every other abide failure gets, so what a reporter threw reads the same as
    // what a handler threw rather than being a second rule for the same job.
    const error = errorPayload(failure).error
    healthLog.warning(`onHealth threw: ${error.name}: ${error.message}`)
    const document = baseline()
    document.error = error
    return document
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
    return json(document, document.error === undefined ? undefined : { status: 503 })
}
