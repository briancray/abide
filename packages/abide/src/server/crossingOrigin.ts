// THE ORIGIN GATE, for every lane a browser on another origin can reach: a handler's over http
// (16.13, 21.19) and over the mux (18.2), and the MCP endpoint's (20.12), all against the one own
// origin (36.2).

import type { Failed } from '#shared/Failed.ts'
import { refuse } from '#shared/refuse.ts'

import { isOwnOrigin } from './config.ts'

/**
 * The `Origin` a request came from when it is not the app's own, and `null` when it is.
 *
 * 36.2 — the app's own are `APP_URL`'s and each `APP_ORIGINS` lists, and the request's where
 * no `APP_URL` is declared.
 */
export function crossingOrigin(
    origin: string | null,
    url: URL | string,
): string | null {
    return origin === null || isOwnOrigin(origin, url) ? null : origin
}

/** Whether a handler's `crossOrigin` admits `origin`. */
export function allows(
    crossOrigin: boolean | string[],
    origin: string,
): boolean {
    return (
        crossOrigin === true ||
        (Array.isArray(crossOrigin) && crossOrigin.includes(origin))
    )
}

/** Whether `crossing` is another origin, and one `crossOrigin` does not admit. 16.13, 18.2. */
export function closedTo(
    crossOrigin: boolean | string[],
    crossing: string | null,
): boolean {
    return crossing !== null && !allows(crossOrigin, crossing)
}

/** The refusal a `spelled` call from `crossing` is answered with, where the gate is closed to it. */
export function crossingRefusal(
    crossing: string | null,
    spelled: string,
): Failed<'HttpError', undefined> {
    return refuse(403, `A ${spelled} from ${crossing} is not allowed here.`)
}
