// 54.30-54.33 — A `Response` THE APP FETCHED ITSELF, read as its type says. The fetch is the caller's —
// its options, its headers, and whatever it throws, which reaches the caller untouched — so `handle`
// is only what comes after: `fetch(url).then(handle)`.

import { holdUntil, retryAtOf } from './Failed.ts'
import { type FetchFailed, fetchFailed } from './fetchFailed.ts'
import { essenceOf, framedStream, framingOf } from './framing.ts'

/**
 * The body a `Response` carries, read as its `content-type` says: JSON as its value, a JSON Lines or
 * event stream as its chunks as they arrive, text as a string, and anything else as a `Blob`. A
 * status outside 2xx is a `FetchFailed`, and so is JSON that does not parse.
 *
 * @param response what a `fetch` answered
 */
export function handle(response: Response): Promise<unknown | FetchFailed> {
    // 54.31 — refused: the status it was answered at, and a body nobody will read let go.
    return response.ok ? readBody(response) : refusedBy(response)
}

/**
 * A 2xx `Response`'s body, read as its `content-type` says (54.30, 54.32, 54.33), or as `as` names
 * whatever its type says (54.17): `handle`'s reading, and `fetchData`'s.
 */
export async function readBody(
    response: Response,
    as?: 'json' | 'text' | 'blob',
): Promise<unknown | FetchFailed> {
    const type = response.headers.get('content-type')
    // 54.32 — a stream is handed back as it arrives, never read to its end first.
    const framing = as === undefined ? framingOf(type) : null
    if (framing !== null)
        return response.body === null
            ? emptyStream()
            : framedStream(response.body, framing)
    if (response.status === 204 || response.body === null) return undefined
    if (as === 'text') return response.text()
    if (as === 'blob') return response.blob()
    const essence = essenceOf(type)
    if (
        as === 'json' ||
        essence === 'application/json' ||
        essence.endsWith('+json')
    ) {
        const text = await response.text()
        try {
            return JSON.parse(text)
        } catch (thrown) {
            const failure = fetchFailed({
                status: response.status,
                reason: 'shape',
            })
            failure.cause = thrown
            return failure
        }
    }
    // 54.33 — text whatever its subtype, and a type that says nothing is text too.
    if (essence === '' || essence.startsWith('text/')) return response.text()
    return response.blob()
}

/**
 * 54.31 — a `Response` outside 2xx as the `FetchFailed` naming its status, its body let go. 15.23,
 * 15.24 — the service's own `Retry-After` is kept with it, so a handler handing it on says it too.
 */
export async function refusedBy(response: Response): Promise<FetchFailed> {
    await response.body?.cancel()
    const failure = fetchFailed({ status: response.status, reason: 'status' })
    const at = retryAtOf(response.headers.get('retry-after'))
    if (at !== undefined) holdUntil(failure, at)
    return failure
}

async function* emptyStream(): AsyncGenerator<never> {}
