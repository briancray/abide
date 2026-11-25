// ANOTHER SERVICE, ASKED WITH A DEADLINE, RETRIES AND A CACHE: 54.7-54.17. A server's helper — the
// fetch carries the server's credentials, and the cache is this process's.

import { isFailed, isTransient, retryAt } from '#shared/Failed.ts'
import { type FetchFailed, fetchFailed } from '#shared/fetchFailed.ts'
import { readBody, refusedBy } from '#shared/handle.ts'
import { isAsyncIterable } from '#shared/isAsyncIterable.ts'
import { namedLogger } from '#shared/log.ts'
import { type Backoff, backoffWait } from '#shared/retryWait.ts'
import { runSchema, type Schema } from '#shared/Schema.ts'
import { sleep } from '#shared/sleep.ts'

/** `fetch`'s own options, and the reading, the deadline, the retries, the cache and the gate beside them. */
export type FetchOptions<T> = RequestInit & {
    /** 54.17 — the body read as JSON, text or a `Blob` whatever its type says, in place of as `handle` reads it. */
    as?: 'json' | 'text' | 'blob' | undefined
    /** 54.7 — the milliseconds one attempt may take before it is aborted; 10000 where none is given. */
    timeout?: number | undefined
    /** 54.8, 54.9 — how many times to ask again after a failure worth asking again; 2 for an idempotent method, 0 for any other. */
    retries?: number | undefined
    /** 54.10 — the first wait before asking again, doubled per retry, or the wait before each retry; 250 where none is given. */
    backoff?: Backoff | undefined
    /** 54.12, 54.13 — the milliseconds a `GET`'s answer is held for the same URL, headers and reading. */
    ttl?: number | undefined
    /** 54.17 — what the body must be, checked before it is the answer. */
    schema?: Schema<T> | undefined
}

const DEFAULT_TIMEOUT = 10_000
const DEFAULT_RETRIES = 2
const FIRST_BACKOFF = 250

// RFC 9110's idempotent methods: the ones 54.9 asks again by default.
const IDEMPOTENT = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'TRACE'])

const FETCH_LOG = namedLogger('abide:fetch')

/** A body held for `ttl`, or one still being asked for, which a second identical ask joins (54.12, 54.13). */
type Held = {
    answer: Promise<unknown>
    expiresAt: number
}

const HELD = new Map<string, Held>()

/** A body as text, checked against `schema` where one is given: 54.7-54.17. */
export function fetchData<T = string>(
    url: string | URL,
    options: FetchOptions<T> & { as: 'text' },
): Promise<T | FetchFailed>
/** A body as a `Blob`, checked against `schema` where one is given: 54.7-54.17. */
export function fetchData<T = Blob>(
    url: string | URL,
    options: FetchOptions<T> & { as: 'blob' },
): Promise<T | FetchFailed>
/**
 * A body read as its `content-type` says, as `handle` reads one, or as JSON where `as` says so,
 * checked against `schema` where one is given: 54.7-54.17.
 */
export function fetchData<T = unknown>(
    url: string | URL,
    options?: FetchOptions<T>,
): Promise<T | FetchFailed>
export async function fetchData<T>(
    url: string | URL,
    options: FetchOptions<T> = {},
): Promise<T | FetchFailed> {
    let asking: FetchOptions<T> = options
    if (options.as === 'json') {
        const headers = new Headers(options.headers)
        if (!headers.has('accept')) headers.set('accept', 'application/json')
        asking = { ...options, headers }
    }
    const body = await answerOf(url, asking)
    if (isFailed(body)) return body as FetchFailed
    if (options.schema === undefined) return body as T
    const result = runSchema(options.schema, body)
    return result.issues === null
        ? (result.value as T)
        : fetchFailed({ status: null, reason: 'shape' })
}

/** The body `url` answers, held and joined where `ttl` asks (54.12, 54.13), asked again where 54.8 says. */
function answerOf<T>(
    url: string | URL,
    options: FetchOptions<T>,
): Promise<unknown> {
    const { ttl = 0, signal } = options
    const method = (options.method ?? 'GET').toUpperCase()
    if (ttl <= 0 || method !== 'GET') return asked(url, options, signal)
    const key = keyOf(url, options)
    const now = Date.now()
    const held = HELD.get(key)
    let answer: Promise<unknown>
    if (held !== undefined && held.expiresAt > now)
        // 54.14 — a stream is its first reader's to drain, so a caller that joined one asks for its own.
        answer = held.answer.then((settled) =>
            isAsyncIterable(settled) ? asked(url, options, signal) : settled,
        )
    else {
        for (const [stale, each] of HELD)
            if (each.expiresAt <= now) HELD.delete(stale)
        // Asked with no caller's signal: one caller leaving does not end it for the rest.
        answer = asked(url, options, undefined)
        const fresh: Held = { answer, expiresAt: Number.POSITIVE_INFINITY }
        HELD.set(key, fresh)
        answer.then((settled) => {
            // 54.14 — a failure is not kept, and neither is a stream, which its first reader drains.
            if (isFailed(settled) || isAsyncIterable(settled)) HELD.delete(key)
            else fresh.expiresAt = Date.now() + ttl
        })
    }
    return signal == null ? answer : abortable(answer, signal)
}

// The headers are part of the key: two callers with different credentials are two answers. So is the
// reading: one body read as text and as JSON is two answers.
function keyOf<T>(url: string | URL, options: FetchOptions<T>): string {
    let key = `${options.as ?? ''} ${url}`
    for (const [name, value] of new Headers(options.headers))
        key += `\n${name}: ${value}`
    return key
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
            // 54.34 — what `fetch` threw — a refused certificate, a name nothing resolves — for the
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
