// THE ORIGIN GATE, for every lane a browser on another origin can reach: a handler's (16.14, 21.19), a
// socket's (18.5) and the MCP endpoint's (20.12), all against the one own origin (36.2).

import type { Failed } from '#shared/Failed.ts'
import { refuse } from '#shared/refuse.ts'
import { appOrigin } from './config.ts'

/**
 * The `Origin` a request came from when it is not the app's own, and `null` when it is.
 *
 * 36.2 — the app's own is `APP_URL`'s where the app declares one, and the request's where not.
 */
export function crossingOrigin(
    origin: string | null,
    url: URL | string,
): string | null {
    if (origin === null) return null
    const own =
        appOrigin() ?? (typeof url === 'string' ? new URL(url) : url).origin
    return origin === own ? null : origin
}

/** Whether a handler's or a socket's `crossOrigin` admits `origin`. */
export function allows(
    crossOrigin: boolean | string[],
    origin: string,
): boolean {
    return (
        crossOrigin === true ||
        (Array.isArray(crossOrigin) && crossOrigin.includes(origin))
    )
}

/** Whether `crossing` is another origin, and one `crossOrigin` does not admit. 16.14, 18.5. */
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
