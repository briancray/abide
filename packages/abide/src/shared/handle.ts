// 54.26-54.29 — A `Response` THE APP FETCHED ITSELF, read as its type says. The fetch is the caller's —
// its options, its headers, and whatever it throws, which reaches the caller untouched — so `handle`
// is only what comes after: `fetch(url).then(handle)`.

import { holdUntil, retryAtOf } from './Failed.ts'
import { type FetchFailed, fetchFailed } from './fetchFailed.ts'
import { essenceOf, framedStream, framingOf, isJsonEssence } from './framing.ts'

/**
 * The body a `Response` carries, read as its `content-type` says: JSON as its value, a JSON Lines or
 * event stream as its chunks as they arrive, text as a string, and anything else as a `Blob`. A
 * status outside 2xx is a `FetchFailed`, and so is JSON that does not parse.
 *
 * @param response what a `fetch` answered
 */
export function handle(response: Response): Promise<unknown | FetchFailed> {
    // 54.27 — refused: the status it was answered at, and what the service said as its cause.
    return response.ok ? readBody(response) : refusedBy(response)
}

/**
 * A 2xx `Response`'s body, read as its `content-type` says (54.26, 54.28, 54.29), or as `as` names
 * whatever its type says (54.13): `handle`'s reading, and `fetchAndHandle`'s.
 */
export async function readBody(
    response: Response,
    as?: 'json' | 'text' | 'blob',
): Promise<unknown | FetchFailed> {
    const type = response.headers.get('content-type')
    // 54.28 — a stream is handed back as it arrives, never read to its end first.
    const framing = as === undefined ? framingOf(type) : null
    if (framing !== null)
        return response.body === null
            ? emptyStream()
            : framedStream(response.body, framing)
    if (response.status === 204 || response.body === null) return undefined
    if (as === 'text') return response.text()
    if (as === 'blob') return response.blob()
    const essence = essenceOf(type)
    if (as === 'json' || isJsonEssence(essence)) {
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
    // 54.29 — text whatever its subtype, and a type that says nothing is text too.
    if (essence === '' || essence.startsWith('text/')) return response.text()
    return response.blob()
}

/**
 * 54.27 — a `Response` outside 2xx as the `FetchFailed` naming its status, what the service said as
 * its `cause`. 15.23, 15.24 — the service's own `Retry-After` is kept with it, so a handler handing
 * it on says it too.
 */
export async function refusedBy(response: Response): Promise<FetchFailed> {
    const failure = fetchFailed({ status: response.status, reason: 'status' })
    failure.cause = await refusalBody(response)
    const at = retryAtOf(response.headers.get('retry-after'))
    if (at !== undefined) holdUntil(failure, at)
    return failure
}

// 54.27 — the most of a refused body read; a longer one is let go unread.
const REFUSAL_BODY_BYTES = 65_536

/**
 * A refused `Response`'s body, read as 54.26 and 54.29 read one — JSON that does not parse, and a
 * stream, as its text — or `undefined` where there is none or it runs past `REFUSAL_BODY_BYTES`.
 */
async function refusalBody(response: Response): Promise<unknown> {
    const body = response.body
    if (body === null) return undefined
    if (Number(response.headers.get('content-length')) > REFUSAL_BODY_BYTES) {
        await body.cancel()
        return undefined
    }
    const chunks: Uint8Array<ArrayBuffer>[] = []
    let size = 0
    const reader = body.getReader()
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > REFUSAL_BODY_BYTES) {
            await reader.cancel()
            return undefined
        }
        chunks.push(value)
    }
    if (size === 0) return undefined
    const type = response.headers.get('content-type')
    const essence = essenceOf(type)
    const json = isJsonEssence(essence)
    const read = new Blob(chunks, { type: type ?? '' })
    if (
        !json &&
        essence !== '' &&
        !essence.startsWith('text/') &&
        framingOf(type) === null
    )
        return read
    const written = await read.text()
    if (!json) return written
    try {
        return JSON.parse(written)
    } catch {
        return written
    }
}

async function* emptyStream(): AsyncGenerator<never> {}
