// `fetch`, ASKED ONCE, ITS BODY READ AS ITS TYPE SAYS: 54.7-54.10, 54.23-54.27. Isomorphic, as
// `fetch` is: on a server a call carries the server's credentials, in a browser the page's.
// NO POLICY OF ITS OWN: an answer held for a while is a `memo` over the call (11.45), and the
// retries, their spacing and a deadline are a `pipe`'s (57.9-57.12), which hands the call the signal
// its attempt aborts with.

import { isFailed, isFailedNamed } from './Failed.ts'
import { type FetchFailed, fetchFailed } from './fetchFailed.ts'
import { readBody, refusedBy } from './handle.ts'
import { runSchema, type Schema } from './Schema.ts'

/** `fetch`'s own options, and the reading and the gate beside them. */
export type FetchOptions<T> = RequestInit & {
    /** 54.10 — the body read as JSON, text or a `Blob` whatever its type says, in place of as `handle` reads it. */
    as?: 'json' | 'text' | 'blob' | undefined
    /** 54.10 — what the body must be, checked before it is the answer. */
    schema?: Schema<T> | undefined
}

/** A body as text, checked against `schema` where one is given: 54.7-54.10. */
function fetchBody<T = string>(
    url: string | URL,
    options: FetchOptions<T> & { as: 'text' },
): Promise<T>
/** A body as a `Blob`, checked against `schema` where one is given: 54.7-54.10. */
function fetchBody<T = Blob>(
    url: string | URL,
    options: FetchOptions<T> & { as: 'blob' },
): Promise<T>
/**
 * A body read as its `content-type` says, as `handle` reads one, or as JSON where `as` says so,
 * checked against `schema` where one is given: 54.7-54.10.
 */
function fetchBody<T = unknown>(
    url: string | URL,
    options?: FetchOptions<T>,
): Promise<T>
async function fetchBody<T>(
    url: string | URL,
    options: FetchOptions<T> = {},
): Promise<T> {
    // 54.9 — a refusal rejects, as a handler's call does (16.3): `await` hands back the body alone.
    const answered = await answeredFor(url, options)
    if (isFailed(answered)) throw answered
    return answered
}

/**
 * Another service's answer, rejected with the `FetchFailed` it was refused with (54.9), and
 * `fetchAndHandle.isError` to narrow a caught failure to one, as `rpc.isError` narrows a handler's (54.37).
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

/** The body `url` answers, checked against `schema`, or the `FetchFailed` it was refused with: one request, 54.7. */
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
    const body = await asked(url, asking)
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
): Promise<unknown> {
    const { as, schema: _schema, ...init } = options
    let response: Response
    try {
        response = await fetch(url, init)
    } catch (thrown) {
        // 54.8 — a caller's abort is theirs, and is thrown as it is.
        if (init.signal?.aborted) throw init.signal.reason
        const failure = fetchFailed({ status: null, reason: 'network' })
        // 54.27 — what `fetch` threw — a refused certificate, a name nothing resolves — for the
        // app to read. `problemOf` sends no `cause`, so it never leaves this server.
        failure.cause = thrown
        return failure
    }
    return response.ok ? readBody(response, as) : refusedBy(response)
}
