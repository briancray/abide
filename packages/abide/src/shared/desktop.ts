// 38.141 — WHICH DESKTOP WINDOW THE WORK RUNNING IS FOR, read off the user agent the window tags
// (38.140). THE REQUEST'S, NEVER THE PROCESS'S: a server connected to (38.71) answers a browser and
// a window at once. The page a request loaded reads `navigator.userAgent`, which is the same text,
// so a server render and its hydration agree.
//
// A HINT, NEVER A CREDENTIAL — any client can send the header — for 20.3's reason.

import { DESKTOP_AGENT } from './DESKTOP_AGENT.ts'
import { isServer } from './isServer.ts'

const TAGGED = new RegExp(`(?:^|\\s)${DESKTOP_AGENT}/(\\S+)`)

/**
 * The user agent of the request being served, or '' outside one.
 *
 * A slot rather than an import, for `TRACE`'s reason: filled by `#server/installServer.ts`.
 */
export const REQUEST_AGENT: { current: () => string } = { current: () => '' }

/** The version of the desktop app whose window the work is for, or `undefined` where none is. */
export function desktop(): { version: string } | undefined {
    const agent = isServer()
        ? REQUEST_AGENT.current()
        : typeof navigator === 'undefined'
          ? ''
          : navigator.userAgent
    const version = TAGGED.exec(agent)?.[1]
    return version === undefined ? undefined : { version }
}
