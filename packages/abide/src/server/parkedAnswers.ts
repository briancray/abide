// 16.94 — AN ANSWER THE MUX BEGAN AND CANNOT CARRY, handed to http rather than made again. The run that
// answered a streaming `GET` over the mux turned out to need what only an http answer delivers — a
// cookie, the `abide-principal` a sign-in writes, a redirect, a binary — so its `Response` is parked,
// whole and unread, under a token the browser alone was sent over its socket, and the browser takes
// it from `PARKED_ADDRESS` as the answer to its call. The handler runs once.

import { PARKED_ADDRESS } from '#shared/ADDRESSES.ts'

import { plainAnswer } from './plainAnswer.ts'
import { randomToken } from './randomToken.ts'

// How long a parked answer waits to be taken before its run is ended.
const PARKED_FOR_MILLISECONDS = 30_000

const PARKED = new Map<
    string,
    {
        answer: Response
        run: AbortController
        expiry: ReturnType<typeof setTimeout>
    }
>()

/** Parks `answer`, whose run `run` ends; returns the token that takes it, once. */
export function park(answer: Response, run: AbortController): string {
    const token = randomToken(24, 'base64url')
    const expiry = setTimeout(() => {
        if (!PARKED.delete(token)) return
        run.abort()
        void answer.body?.cancel().catch(() => {})
    }, PARKED_FOR_MILLISECONDS)
    expiry.unref()
    PARKED.set(token, { answer, run, expiry })
    return token
}

/**
 * The parked answer `request` takes, where it asks `PARKED_ADDRESS` (below the mount); a 404 for a
 * token that names none; `undefined` for any other request.
 *
 * Its run is ended once this request hangs up, as the run of an answer asked over http is.
 */
export function takeParked(request: Request): Response | undefined {
    const url = new URL(request.url)
    if (url.pathname !== PARKED_ADDRESS || request.method !== 'GET')
        return undefined
    const token = url.searchParams.get('token') ?? ''
    const parked = PARKED.get(token)
    if (parked === undefined)
        return plainAnswer('no answer is parked under this token', 404)
    PARKED.delete(token)
    clearTimeout(parked.expiry)
    request.signal.addEventListener('abort', () => parked.run.abort(), {
        once: true,
    })
    return parked.answer
}
