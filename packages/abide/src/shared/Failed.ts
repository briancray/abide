// THE ONE REFUSAL TYPE, in-process and over a wire alike. RULEBOOK 15.1: a refusal is a
// declared VALUE, not a status code and not a transport concern — so the same object a
// `transform` returns (4.6) is the one a handler answers with (16.40) and the one a client
// narrows on (3.1), with nothing converting between three spellings on the way.
//
// IT IS AN `Error` AND IT IS NEVER THROWN, which is the pairing that takes the most
// explaining. 15.5 makes RETURNING one the refusal and 15.4 makes constructing one inert,
// so the `Error` base is not there to be thrown — it is there for the stack, for
// `console` rendering it as a failure rather than as a bag, and so that a `catch` that
// caught one from somewhere else still finds the shape it expects.

import { FAILURE_STATUS_TEXT } from './FAILURE_STATUS_TEXT.ts'
import { TRANSIENT_STATUSES } from './TRANSIENT_STATUSES.ts'

/**
 * A refusal: a named, status-carrying `Error` that is returned, never thrown.
 *
 * `Data` IS UNCONSTRAINED, and that is the registry row rather than an oversight here.
 * `refuse.named` is where `JsonValue` binds, because that is the factory whose refusals
 * cross a wire — and `Issues<T>` is the case that proves the two must differ: it is
 * `Partial<Record<…, string[]>>`, whose members are `string[] | undefined`, so it is a
 * perfectly good refusal payload that `JsonValue` does not describe.
 */
export type Failed<Name extends string = string, Data = undefined> = Error & {
    name: Name
    status: number
    message: string
    data: Data
}

/**
 * Whether a value is a refusal: a string `name`, a number `status` and a string `message`.
 *
 * 15.6: STRUCTURAL, and the clause is load-bearing rather than a preference. A `Failed`
 * that crossed a wire was rebuilt from JSON by whatever revived it, so it is not
 * `instanceof Error` and carries no brand this side put on it — a nominal check would
 * answer false for the case the type exists to serve.
 *
 * THE THREE FIELDS ARE THE TEST, and `data` is not one of them: a refusal declaring no
 * data has `undefined` there, and `JSON.stringify` drops an `undefined` member entirely,
 * so requiring the key would fail exactly the values that made the trip.
 *
 * WHAT IT ADMITS is anything carrying a name, a status and a message — an error object
 * from some other library that happens to have all three. That is 15.6 working as written
 * rather than a hole in it: the clause says what a refusal IS, and something with all
 * three is one.
 */
export function isFailed(value: unknown): value is Failed<string, unknown> {
    if (value === null || typeof value !== 'object') return false
    const held = value as {
        name?: unknown
        status?: unknown
        message?: unknown
    }
    return (
        typeof held.name === 'string' &&
        typeof held.status === 'number' &&
        typeof held.message === 'string'
    )
}

/**
 * Builds a `Failed` with all four fields enumerable.
 *
 * The one place a `Failed` is built, so the four fields are written in one order and
 * nothing downstream meets two shapes. 15.4: INERT. Nothing here throws, nothing is
 * registered, and no caller is told — a `Failed` nobody returns is an object nobody reads,
 * which is what makes 15.10 a compile-time rule rather than a runtime one.
 *
 * `message` IS ASSIGNED RATHER THAN LEFT TO THE CONSTRUCTOR. `new Error(m)` writes an
 * own property that is NOT enumerable, so `JSON.stringify` of a refusal dropped it — the wire
 * carried `{"name":"HttpError","status":503}` and `isFailed` answered FALSE for what came back,
 * because the message is one of the three fields 15.6 tests. The type's whole point is surviving
 * that trip. `name`, `status` and `data` are ordinary assignments and already enumerable.
 */
export function failed<Name extends string, Data>(
    name: Name,
    status: number,
    message: string,
    data: Data,
): Failed<Name, Data> {
    // Constructed with NO argument the `Error` installs no own `message` at all, so the
    // assignment below is the first writer and lands enumerable like the other three —
    // where redefining the constructor's own property reconfigures a property already there.
    const refusal = new Error() as Failed<Name, Data>
    refusal.message = message
    refusal.name = name
    refusal.status = status
    refusal.data = data
    return refusal
}

/**
 * A refusal as it crosses a wire: a Problem Details object (RFC 9457).
 *
 * 15.1 — `type` is the refusal's name, or `about:blank` for an undeclared one, whose `title` is then
 * its status's reason phrase; `detail` is the message, and `data` rides as an extension member.
 */
export type Problem = {
    type: string
    title: string
    status: number
    detail: string
    data?: unknown
}

/**
 * The Problem Details a refusal crosses a wire as.
 *
 * 15.1 — whatever else the refusal carried is dropped. `isFailed` admits another library's error,
 * whose `message` the constructor left unenumerable, so the fields are read rather than spread.
 */
export function problemOf(failure: Failed<string, unknown>): Problem {
    const undeclared = failure.name === 'HttpError'
    const problem: Problem = {
        type: undeclared ? 'about:blank' : failure.name,
        title: undeclared
            ? (FAILURE_STATUS_TEXT[failure.status] ?? failure.name)
            : failure.name,
        status: failure.status,
        detail: failure.message,
    }
    if (failure.data !== undefined) problem.data = failure.data
    return problem
}

/** Whether a value read off a wire is Problem Details: a `type` and a numeric `status`. */
export function isProblem(value: unknown): value is Problem {
    if (value === null || typeof value !== 'object') return false
    const held = value as { type?: unknown; status?: unknown }
    return typeof held.type === 'string' && typeof held.status === 'number'
}

/** The refusal Problem Details names, rebuilt: `about:blank` is an undeclared `HttpError`. */
export function failedFrom(problem: Problem): Failed<string, unknown> {
    return failed(
        problem.type === 'about:blank' ? 'HttpError' : problem.type,
        problem.status,
        problem.detail ?? problem.title ?? '',
        problem.data,
    )
}

/**
 * Whether a refusal at `status` says "not now" rather than "no": 15.19's, which the next reach runs
 * again rather than holds.
 */
export function isTransient(status: number): boolean {
    return status >= 500 || TRANSIENT_STATUSES.includes(status)
}

/**
 * 15.19 — whether `failure` says "not now": by its own status, or a `FetchFailed`'s by the status its
 * service answered, and as "not now" where the service did not answer at all. Its own is 502 whatever
 * the service said, so read by its status alone a service's 404 was asked again.
 */
export function refusedTransiently(failure: Failed<string, unknown>): boolean {
    if (failure.name !== 'FetchFailed') return isTransient(failure.status)
    const { status, reason } = failure.data as {
        status: number | null
        reason: string
    }
    return status === null ? reason === 'network' : isTransient(status)
}

/**
 * 15.23 — the time a refusal's `Retry-After` named, kept beside the refusal rather than on it: 15.1's
 * four fields are what a `Failed` is, and this is what the answer carrying one said of it.
 */
const RETRY_AT = new WeakMap<object, number>()

/** The time, in epoch ms, before which `failure` is served rather than run again — 15.23. */
export function retryAt(failure: object): number | undefined {
    return RETRY_AT.get(failure)
}

/** Keeps `at` as the time `failure`'s `Retry-After` named. */
export function holdUntil(failure: object, at: number): void {
    RETRY_AT.set(failure, at)
}

/** 37.24 — the trace id the answer carrying a refusal named, kept beside it as `RETRY_AT` is. */
const TRACES = new WeakMap<object, string>()

/** The trace id the answer `failure` was rebuilt from named, where it named one — 48.1. */
export function traceOf(failure: unknown): string | undefined {
    return typeof failure === 'object' && failure !== null
        ? TRACES.get(failure)
        : undefined
}

/** Keeps `trace` as the one the answer carrying `failure` named. */
export function tracedBy(failure: object, trace: string): void {
    TRACES.set(failure, trace)
}

/** A `Retry-After` header's time in epoch ms — delay-seconds or an HTTP date — or `undefined`. */
export function retryAtOf(header: string | null): number | undefined {
    if (header === null) return undefined
    const text = header.trim()
    if (/^\d+$/.test(text)) return Date.now() + Number(text) * 1000
    const date = Date.parse(text)
    return Number.isNaN(date) ? undefined : date
}

/** The `Retry-After` `failure` crosses a wire with — 15.24 — as the whole seconds left, or `undefined`. */
export function retryAfterOf(failure: object): string | undefined {
    const at = RETRY_AT.get(failure)
    if (at === undefined) return undefined
    return String(Math.max(0, Math.ceil((at - Date.now()) / 1000)))
}

/** Whether a value is the refusal of that name: `Rpc.isError` and a value's alike (3.1). */
export function isFailedNamed(error: unknown, name: string): boolean {
    return isFailed(error) && error.name === name
}
