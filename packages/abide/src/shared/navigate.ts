import { CURRENT_ROUTER, type NavigateOptions } from './CURRENT_ROUTER.ts'

/**
 * Navigates the document's router to a URL, or steps its history by a number of entries, without
 * reloading; rejects where there is no router.
 *
 * 30.7 — NAVIGATES, AND MUST NOT RELOAD THE DOCUMENT. The whole of that clause lives in the client
 * router; this is the app-facing name, and it sits on the isomorphic seam because that is the
 * specifier an app imports it through, with the same intent on both sides.
 *
 * ON A SERVER THERE IS NO DOCUMENT NOT TO RELOAD, so there is nothing this can mean yet and it
 * refuses rather than resolving quietly — a `navigate` that no-ops during a render is a page that
 * renders the wrong thing and says nothing.
 */
export function navigate(by: number): Promise<void>
export function navigate(
    url?: URL | string,
    options?: NavigateOptions,
): Promise<void>
export function navigate(
    to: URL | string | number = '',
    options: NavigateOptions = {},
): Promise<void> {
    const router = CURRENT_ROUTER.current
    if (router === null) return Promise.reject(noRouter('navigate()'))
    // 30.38 — A NUMBER IS A STEP THROUGH THE HISTORY, as `history.go` takes one.
    return typeof to === 'number' ? router.step(to) : router.go(to, options)
}

/**
 * What a navigation with no router in the document is refused with — `navigate`'s, and a
 * `route.query` write's (30.46).
 */
export function noRouter(caller: string): Error {
    return new Error(
        `${caller} was called with no router in this document. A browser gets one from the routes the build emitted; a server render has no document to navigate (RULEBOOK 30.7).`,
    )
}
