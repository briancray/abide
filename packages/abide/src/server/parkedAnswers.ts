// 16.94 — AN ANSWER THE MUX BEGAN AND CANNOT CARRY, handed to http rather than made again. The run that
// answered a streaming `GET` over the mux turned out to need what only an http answer delivers — a
// cookie, the `abide-principal` a sign-in writes, a redirect, a binary — so its `Response` is parked,
// whole and unread, under a token the browser alone was sent over its socket, and the browser takes
// it from `PARKED_ADDRESS` as the answer to its call. The handler runs once.
//
// 16.98 — IT MAY CARRY ANOTHER BROWSER'S SESSION, so the token alone takes nothing: an answer is filed
// under the caller and the sign-in of the request it answered, and only a request carrying both takes
// it — any other is answered as if nothing were parked. The token rides in `PARKED_HEADER`, never the
// URL, and the answer is not stored.

import { PARKED_ADDRESS } from '#shared/ADDRESSES.ts'
import { PARKED_HEADER } from '#shared/PARKED_HEADER.ts'

import { callerCookieOf } from './callerOf.ts'
import { plainAnswer } from './plainAnswer.ts'
import { signedInBy } from './principal.ts'
import { randomToken } from './randomToken.ts'

// How long a parked answer waits to be taken before its run is ended.
const PARKED_FOR_MILLISECONDS = 30_000

const PARKED = new Map<
    string,
    {
        answer: Response
        run: AbortController
        // The caller and the sign-in of the request it answered, which alone may take it.
        owner: string
        expiry: ReturnType<typeof setTimeout>
    }
>()

/** Who `request` is, as a parked answer is filed under it: its caller and its sign-in, or `undefined`. */
function ownerOf(request: Request): string | undefined {
    const caller = callerCookieOf(request)
    return caller === undefined
        ? undefined
        : `${caller}\n${signedInBy(request)}`
}

/**
 * Parks `answer` to `request`, whose run `run` ends; returns the token that takes it, once — or
 * `undefined` where `request` names no caller to file it under, and it is ended instead.
 */
export function park(
    answer: Response,
    run: AbortController,
    request: Request,
): string | undefined {
    const owner = ownerOf(request)
    if (owner === undefined) {
        run.abort()
        void answer.body?.cancel().catch(() => {})
        return undefined
    }
    const token = randomToken(24, 'base64url')
    const expiry = setTimeout(() => {
        if (!PARKED.delete(token)) return
        run.abort()
        void answer.body?.cancel().catch(() => {})
    }, PARKED_FOR_MILLISECONDS)
    expiry.unref()
    PARKED.set(token, { answer, run, owner, expiry })
    return token
}

/**
 * The parked answer `request` takes, where it asks `PARKED_ADDRESS` (below the mount); a 404 for a
 * token that names none, or one parked for another caller or sign-in; `undefined` for any other
 * request.
 *
 * Its run is ended once this request hangs up, as the run of an answer asked over http is.
 */
export function takeParked(request: Request): Response | undefined {
    if (new URL(request.url).pathname !== PARKED_ADDRESS) return undefined
    const parked = PARKED.get(request.headers.get(PARKED_HEADER) ?? '')
    // 16.98 — ANOTHER'S IS NOT THERE: the same answer as a token that names nothing, so a token seen
    // elsewhere says nothing about what it names.
    if (
        request.method !== 'GET' ||
        parked === undefined ||
        parked.owner !== ownerOf(request)
    )
        return plainAnswer('no answer is parked under this token', 404)
    PARKED.delete(request.headers.get(PARKED_HEADER) ?? '')
    clearTimeout(parked.expiry)
    request.signal.addEventListener('abort', () => parked.run.abort(), {
        once: true,
    })
    const { answer } = parked
    const headers = new Headers(answer.headers)
    headers.set('cache-control', 'no-store')
    return new Response(answer.body, {
        status: answer.status,
        statusText: answer.statusText,
        headers,
    })
}
