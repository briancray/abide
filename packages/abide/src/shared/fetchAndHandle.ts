// `fetch`, ASKED WITH A DEADLINE AND RETRIES, ITS BODY READ AS ITS TYPE SAYS: 54.7-54.13, 54.26-54.30.
// Isomorphic, as `fetch` is: on a server a call carries the server's credentials, in a browser the
// page's. NO CACHE OF ITS OWN: an answer held for a while is a `memo` over the call (11.45), keyed by
// what the caller asks with.

import { isFailed, isFailedNamed, isTransient, retryAt } from './Failed.ts'
import { type FetchFailed, fetchFailed } from './fetchFailed.ts'
import { readBody, refusedBy } from './handle.ts'
import { namedLogger } from './log.ts'
import { type Backoff, backoffWait } from './retryWait.ts'
import { runSchema, type Schema } from './Schema.ts'
import { sleep } from './sleep.ts'

/** `fetch`'s own options, and the reading, the deadline, the retries, the cache and the gate beside them. */
export type FetchOptions<T> = RequestInit & {
    /** 54.13 — the body read as JSON, text or a `Blob` whatever its type says, in place of as `handle` reads it. */
    as?: 'json' | 'text' | 'blob' | undefined
    /** 54.7 — the milliseconds one attempt may take before it is aborted; 10000 where none is given. */
    timeout?: number | undefined
    /** 54.8, 54.9 — how many times to ask again after a failure worth asking again; 2 for an idempotent method, 0 for any other. */
    retries?: number | undefined
    /** 54.10 — the first wait before asking again, doubled per retry, or the wait before each retry; 250 where none is given. */
    backoff?: Backoff | undefined
    /** 54.13 — what the body must be, checked before it is the answer. */
    schema?: Schema<T> | undefined
}

const DEFAULT_TIMEOUT = 10_000
const DEFAULT_RETRIES = 2
const FIRST_BACKOFF = 250

// RFC 9110's idempotent methods: the ones 54.9 asks again by default.
const IDEMPOTENT = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'TRACE'])

const FETCH_LOG = namedLogger('abide:fetch')

/** A body as text, checked against `schema` where one is given: 54.7-54.13. */
function fetchBody<T = string>(
    url: string | URL,
    options: FetchOptions<T> & { as: 'text' },
): Promise<T>
/** A body as a `Blob`, checked against `schema` where one is given: 54.7-54.13. */
function fetchBody<T = Blob>(
    url: string | URL,
    options: FetchOptions<T> & { as: 'blob' },
): Promise<T>
/**
 * A body read as its `content-type` says, as `handle` reads one, or as JSON where `as` says so,
 * checked against `schema` where one is given: 54.7-54.13.
 */
function fetchBody<T = unknown>(
    url: string | URL,
    options?: FetchOptions<T>,
): Promise<T>
async function fetchBody<T>(
    url: string | URL,
    options: FetchOptions<T> = {},
): Promise<T> {
    // 54.12 — a refusal rejects, as a handler's call does (16.3): `await` hands back the body alone.
    const answered = await answeredFor(url, options)
    if (isFailed(answered)) throw answered
    return answered
}

/**
 * Another service's answer, rejected with the `FetchFailed` it gave up with (54.12), and
 * `fetchAndHandle.isError` to narrow a caught failure to one, as `rpc.isError` narrows a handler's (54.40).
 */
export const fetchAndHandle: typeof fetchBody & {
    isError<Name extends 'FetchFailed'>(
        error: unknown,
        name: Name,
    ): error is FetchFailed
} = Object.assign(fetchBody, {
    isError: (error: unknown, name: 'FetchFailed'): error is FetchFailed =>
        isFailedNamed(error, name),
})

/** The body `url` answers, checked against `schema`, or the `FetchFailed` it was refused with. */
async function answeredFor<T>(
    url: string | URL,
    options: FetchOptions<T>,
): Promise<T | FetchFailed> {
    let asking: FetchOptions<T> = options
    if (options.as === 'json') {
        const headers = new Headers(options.headers)
        if (!headers.has('accept')) headers.set('accept', 'application/json')
        asking = { ...options, headers }
    }
    const body = await asked(url, asking, asking.signal)
    if (isFailed(body)) return body as FetchFailed
    if (options.schema === undefined) return body as T
    const result = runSchema(options.schema, body)
    return result.issues === null
        ? (result.value as T)
        : fetchFailed({ status: null, reason: 'shape' })
}

async function asked<T>(
    url: string | URL,
    options: FetchOptions<T>,
    signal: AbortSignal | null | undefined,
): Promise<unknown> {
    const {
        as,
        timeout = DEFAULT_TIMEOUT,
        retries: retriesGiven,
        backoff,
        schema: _schema,
        ...init
    } = options
    const method = (init.method ?? 'GET').toUpperCase()
    const retries =
        retriesGiven ?? (IDEMPOTENT.has(method) ? DEFAULT_RETRIES : 0)
    for (let attempt = 0; ; attempt += 1) {
        const deadline = AbortSignal.timeout(timeout)
        let failure: FetchFailed
        let notBefore: number | undefined
        try {
            const response = await fetch(url, {
                ...init,
                signal: signal ? AbortSignal.any([deadline, signal]) : deadline,
            })
            if (response.ok) return await readBody(response, as)
            failure = await refusedBy(response)
            if (!isTransient(response.status)) return failure
            notBefore = retryAt(failure)
        } catch (thrown) {
            // 54.11 — a caller's abort is theirs, and is never a failure to ask again.
            if (signal?.aborted) throw signal.reason
            failure = fetchFailed({
                status: null,
                reason: deadline.aborted ? 'timeout' : 'network',
            })
            // 54.30 — what `fetch` threw — a refused certificate, a name nothing resolves — for the
            // app to read. `problemOf` sends no `cause`, so it never leaves this server.
            failure.cause = thrown
        }
        if (attempt >= retries) return failure
        // 54.10 — bounded by `retries` rather than a ceiling: a step past `timeout` is not waited on.
        const wait = backoffWait(backoff, attempt, FIRST_BACKOFF, notBefore)
        // 54.10 — a service asking for longer than one attempt may take is not waited on.
        if (wait > timeout) return failure
        FETCH_LOG.debug(
            'asking again',
            redacted(url),
            failure.message,
            `in ${wait} ms`,
        )
        await paused(wait, signal)
    }
}

// A logged address without its query, which is where a key rides.
function redacted(url: string | URL): string {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
}

function paused(
    milliseconds: number,
    signal: AbortSignal | null | undefined,
): Promise<void> {
    return signal == null
        ? Bun.sleep(milliseconds)
        : sleep(milliseconds, signal)
}
