import { isFailed } from '#shared/Failed.ts'

import { type FetchFailed, fetchFailed } from './fetchFailed.ts'
import { bodyOf, checked, type FetchOptions } from './fetchText.ts'

/** A body as JSON, checked against `schema` where one is given: 54.7-54.17. */
export async function fetchJson<T = unknown>(
    url: string | URL,
    options: FetchOptions<T> = {},
): Promise<T | FetchFailed> {
    const headers = new Headers(options.headers)
    if (!headers.has('accept')) headers.set('accept', 'application/json')
    const body = await bodyOf(url, { ...options, headers })
    if (isFailed(body)) return body
    let parsed: unknown
    try {
        parsed = JSON.parse(body)
    } catch {
        return fetchFailed({ status: null, reason: 'shape' })
    }
    return options.schema === undefined
        ? (parsed as T)
        : checked(parsed, options.schema)
}
