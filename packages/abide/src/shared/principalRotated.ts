// 26.24 — A SIGN-IN OR SIGN-OUT A HANDLER ANSWERED makes everything this tab holds another caller's,
// so the tab refreshes all of it — a bare `refresh` (13.7), less a `global` value, which no one
// caller's read made — and every other tab of this browser is told over a `BroadcastChannel`, since the cookie each reads by is the same one. Here rather than in
// `principal.ts` because the tab that made the call may never have read `principal` — the sign-in
// page whose form calls the handler — and that tab still has to tell the rest.
//
// A `GET` THAT SIGNED IN refreshes only what listens here, `principal` among it: a `GET` is what a
// refresh calls, so one answering the header again would refresh everything again, without end.

import { isServer } from './isServer.ts'
import { PRINCIPAL_HEADER } from './PRINCIPAL_HEADER.ts'
import { refreshCallerHeld } from './reactive/producer.ts'

/** Each is told whether the tab's refresh already reached everything it holds. */
const LISTENERS: ((everything: boolean) => void)[] = []

let tabs: BroadcastChannel | undefined

function rotated(everything: boolean): void {
    // AHEAD OF THE LISTENERS: the mux's reopens its socket and runs again a stream it carries
    // (18.25), so a stream this refresh had not yet started over would run twice. A server holds
    // nothing of a browser's to refresh.
    if (everything && !isServer()) refreshCallerHeld()
    for (const listener of LISTENERS) listener(everything)
}

/**
 * The one channel this tab is told and tells on. One instance, because a `BroadcastChannel`
 * delivers to every OTHER instance of its name — a second one in this tab would hear its own
 * sign-in.
 */
function channel(): BroadcastChannel | undefined {
    if (tabs === undefined && typeof BroadcastChannel === 'function') {
        tabs = new BroadcastChannel('abide:principal')
        tabs.onmessage = (message) => rotated(message.data === 'everything')
    }
    return tabs
}

/**
 * Runs `listener` on every sign-in or sign-out this tab's calls answer, and — where `tabs` — on
 * every one another tab's do, after the tab's refresh where there is one.
 *
 * Nothing listens until something is read by the cookie, so a page that reads nothing of it opens
 * no channel.
 */
export function onPrincipalRotated(
    listener: (everything: boolean) => void,
    tabs: boolean,
): void {
    LISTENERS.push(listener)
    if (tabs) channel()
}

/**
 * Tells this tab and the others, where `answer` — to a call made with `method` — says the cookie
 * changed.
 */
export function principalRotated(answer: Response, method: string): void {
    if (!answer.headers.has(PRINCIPAL_HEADER)) return
    // Upper-cased as `fetch` normalizes it: `raw` is handed the caller's own spelling.
    const everything = method.toUpperCase() !== 'GET'
    rotated(everything)
    channel()?.postMessage(everything ? 'everything' : 'principal')
}
