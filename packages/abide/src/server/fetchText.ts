// ANOTHER SERVICE, ASKED WITH A DEADLINE, RETRIES AND A CACHE: 54.7-54.17. A server's helper — the
// fetch carries the server's credentials, and the cache is this process's.

import { isFailed, isTransient, retryAt } from '#shared/Failed.ts'
import { type FetchFailed, fetchFailed } from '#shared/fetchFailed.ts'
import { refusedBy } from '#shared/handle.ts'
import { namedLogger } from '#shared/log.ts'
import { runSchema, type Schema } from '#shared/Schema.ts'

/** `fetch`'s own options, and the deadline, the retries, the cache and the gate beside them. */
export type FetchOptions<T> = RequestInit & {
    /** 54.7 — the milliseconds one attempt may take before it is aborted; 10000 where none is given. */
    timeout?: number
    /** 54.8, 54.9 — how many times to ask again after a failure worth asking again; 2 for an idempotent method, 0 for any other. */
    retries?: number
    /** 54.12, 54.13 — the milliseconds a `GET`'s answer is held for the same URL and headers. */
    ttl?: number
    /** 54.17 — what the body must be, checked before it is the answer. */
    schema?: Schema<T>
}

const DEFAULT_TIMEOUT = 10_000
const DEFAULT_RETRIES = 2
const FIRST_BACKOFF = 250

// RFC 9110's idempotent methods: the ones 54.9 asks again by default.
const IDEMPOTENT = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'TRACE'])

const FETCH_LOG = namedLogger('abide:fetch')

/** A body held for `ttl`, or one still being asked for, which a second identical ask joins (54.12, 54.13). */
type Held = {
    answer: Promise<string | FetchFailed>
    expiresAt: number
}

const HELD = new Map<string, Held>()

/** A body as text, checked against `schema` where one is given: 54.7-54.17. */
export async function fetchText(
    url: string | URL,
    options: FetchOptions<string> = {},
): Promise<string | FetchFailed> {
    const body = await bodyOf(url, options)
    if (isFailed(body) || options.schema === undefined) return body
    return checked(body, options.schema)
}

/** `value` as `schema` accepts it, or a `FetchFailed` for its shape (54.17). */
export function checked<T>(value: unknown, schema: Schema<T>): T | FetchFailed {
    const result = runSchema(schema, value)
    return result.issues === null
        ? (result.value as T)
        : fetchFailed({ status: null, reason: 'shape' })
}

/** The body `url` answers, held and joined where `ttl` asks (54.12, 54.13), asked again where 54.8 says. */
export function bodyOf(
    url: string | URL,
    options: FetchOptions<unknown>,
): Promise<string | FetchFailed> {
    const { ttl = 0, signal } = options
    const method = (options.method ?? 'GET').toUpperCase()
    if (ttl <= 0 || method !== 'GET') return asked(url, options, signal)
    const key = keyOf(url, options.headers)
    const now = Date.now()
    let held = HELD.get(key)
    if (held === undefined || held.expiresAt <= now) {
        for (const [stale, each] of HELD)
            if (each.expiresAt <= now) HELD.delete(stale)
        // Asked with no caller's signal: one caller leaving does not end it for the rest.
        const answer = asked(url, options, undefined)
        const fresh: Held = { answer, expiresAt: Number.POSITIVE_INFINITY }
        held = fresh
        HELD.set(key, fresh)
        answer.then((settled) => {
            // 54.14 — a failure is not kept, and the next ask runs again.
            if (isFailed(settled)) HELD.delete(key)
            else fresh.expiresAt = Date.now() + ttl
        })
    }
    return signal == null ? held.answer : abortable(held.answer, signal)
}

// The headers are part of the key: two callers with different credentials are two answers.
function keyOf(url: string | URL, headers: HeadersInit | undefined): string {
    let key = String(url)
    for (const [name, value] of new Headers(headers))
        key += `\n${name}: ${value}`
    return key
}

async function asked(
    url: string | URL,
    options: FetchOptions<unknown>,
    signal: AbortSignal | null | undefined,
): Promise<string | FetchFailed> {
    const {
        timeout = DEFAULT_TIMEOUT,
        retries: retriesGiven,
        ttl: _ttl,
        schema: _schema,
        ...init
    } = options
    const method = (init.method ?? 'GET').toUpperCase()
    const retries =
        retriesGiven ?? (IDEMPOTENT.has(method) ? DEFAULT_RETRIES : 0)
    for (let attempt = 0; ; attempt += 1) {
        const deadline = AbortSignal.timeout(timeout)
        let failure: FetchFailed
        let retryAfter: number | undefined
        try {
            const response = await fetch(url, {
                ...init,
                signal: signal ? AbortSignal.any([deadline, signal]) : deadline,
            })
            if (response.ok) return await response.text()
            failure = await refusedBy(response)
            if (!isTransient(response.status)) return failure
            const at = retryAt(failure)
            retryAfter =
                at === undefined ? undefined : Math.max(0, at - Date.now())
        } catch (thrown) {
            // 54.11 — a caller's abort is theirs, and is never a failure to ask again.
            if (signal?.aborted) throw signal.reason
            failure = fetchFailed({
                status: null,
                reason: deadline.aborted ? 'timeout' : 'network',
            })
            // 54.34 — what `fetch` threw — a refused certificate, a name nothing resolves — for the
            // app to read. `problemOf` sends no `cause`, so it never leaves this server.
            failure.cause = thrown
        }
        if (attempt >= retries) return failure
        const wait = retryAfter ?? FIRST_BACKOFF * 2 ** attempt
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
    const slept = Bun.sleep(milliseconds)
    return signal == null ? slept : abortable(slept, signal)
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason)
    return new Promise((resolve, reject) => {
        const stop = () => reject(signal.reason)
        signal.addEventListener('abort', stop, { once: true })
        work.then(
            (value) => {
                signal.removeEventListener('abort', stop)
                resolve(value)
            },
            (error) => {
                signal.removeEventListener('abort', stop)
                reject(error)
            },
        )
    })
}
