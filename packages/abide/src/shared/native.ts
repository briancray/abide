// 38.141 — WHICH NATIVE WINDOW THE WORK RUNNING IS FOR, read off the user agent the window tags
// (38.140). THE REQUEST'S, NEVER THE PROCESS'S: a server connected to (38.71) answers a browser and
// a window at once. The page a request loaded reads `navigator.userAgent`, which is the same text,
// so a server render and its hydration agree.
//
// A HINT, NEVER A CREDENTIAL — any client can send the header — for 20.3's reason.

import { isServer } from './isServer.ts'
import { NATIVE_AGENT } from './NATIVE_AGENT.ts'

// The version, then the name in a comment, its parentheses and backslashes quoted (RFC 9110 5.6.5).
const TAGGED = new RegExp(
    `(?:^|\\s)${NATIVE_AGENT}/(\\S+) \\(((?:\\\\.|[^\\\\)])*)\\)`,
)

/**
 * The user agent of the request being served, or '' outside one.
 *
 * A slot rather than an import, for `TRACE`'s reason: filled by `#server/installServer.ts`.
 */
export const REQUEST_AGENT: { current: () => string } = { current: () => '' }

/**
 * The version of the native app whose window the work is for, and the name its menu bar shows, or
 * `undefined` where none is.
 */
export function native(): { version: string; name: string } | undefined {
    const agent = isServer()
        ? REQUEST_AGENT.current()
        : typeof navigator === 'undefined'
          ? ''
          : navigator.userAgent
    const tagged = TAGGED.exec(agent)
    if (tagged === null) return undefined
    return {
        version: tagged[1] as string,
        name: (tagged[2] as string).replace(/\\(.)/g, '$1'),
    }
}
