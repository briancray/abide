// 26.24 — A SIGN-IN OR SIGN-OUT A HANDLER ANSWERED is heard by everything in this tab that holds
// something read by the caller's cookie, and every other tab of this browser is told over a
// `BroadcastChannel`, since the cookie each reads by is the same one. Here rather than in
// `principal.ts` because the tab that made the call may never have read `principal` — the sign-in
// page whose form calls the handler — and that tab still has to tell the rest.

import { PRINCIPAL_HEADER } from './PRINCIPAL_HEADER.ts'

const LISTENERS: (() => void)[] = []

let tabs: BroadcastChannel | undefined

function rotated(): void {
    for (const listener of LISTENERS) listener()
}

/**
 * The one channel this tab is told and tells on. One instance, because a `BroadcastChannel`
 * delivers to every OTHER instance of its name — a second one in this tab would hear its own
 * sign-in.
 */
function channel(): BroadcastChannel | undefined {
    if (tabs === undefined && typeof BroadcastChannel === 'function') {
        tabs = new BroadcastChannel('abide:principal')
        tabs.onmessage = rotated
    }
    return tabs
}

/**
 * Runs `listener` on every sign-in or sign-out this tab's calls answer, and — where `tabs` — on
 * every one another tab's do.
 *
 * Nothing listens until something is read by the cookie, so a page that reads nothing of it opens
 * no channel.
 */
export function onPrincipalRotated(listener: () => void, tabs: boolean): void {
    LISTENERS.push(listener)
    if (tabs) channel()
}

/** Tells this tab and the others, where `answer` says the cookie changed. */
export function principalRotated(answer: Response): void {
    if (!answer.headers.has(PRINCIPAL_HEADER)) return
    rotated()
    channel()?.postMessage('rotated')
}
