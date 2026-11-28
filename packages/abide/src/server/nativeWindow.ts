// 44.77, 44.79, 44.100 — THE NATIVE APP'S WINDOW, as the server knows it: the credential the process
// minted for it and its window carries in a cookie, and the window's latest request with the app it
// reached. What a request from the window is told apart by — the bridge lending it this machine's
// Claude Code, a report carrying the server's lines, a conversation run before the window has asked
// anything — read here rather than off the bridge or the assistant, which each only ask.

import { randomToken } from '#shared/randomToken.ts'

import { askerOf } from './askerOf.ts'
import { CALLER_COOKIE } from './callerOf.ts'
import { cookieOf } from './cookieOf.ts'
import { type AnsweringApp, request } from './requestScope.ts'

/** The cookie the native app's window carries its credential in. 44.79. */
export const NATIVE_COOKIE = 'abide-native-credential'

// The credential, `''` outside the native app; the window's latest request as a tool call carries
// it, and the app it reached — or, before it has made one, the app booted last; and the caller a
// conversation before the window's first request is, minted once: a bridge pairs with a browser
// (44.13), and the window has not been handed one yet.
const WINDOW: {
    secret: string
    asker: Request | undefined
    app: AnsweringApp | undefined
    caller: string | undefined
} = {
    secret: '',
    asker: undefined,
    app: undefined,
    caller: undefined,
}

/** Holds `secret` as the credential the native app's window carries. 44.79. */
export function holdWindowCredential(secret: string): void {
    WINDOW.secret = secret
}

/** The native app's window credential, or `undefined` outside the native app. 44.79, 44.100. */
export function windowCredential(): string | undefined {
    return WINDOW.secret === '' ? undefined : WINDOW.secret
}

/** Whether `given` carries the native app's window credential. 44.79. */
export function carriesWindowCredential(given: Request): boolean {
    if (WINDOW.secret === '') return false
    return cookieOf(given, NATIVE_COOKIE) === WINDOW.secret
}

/** Whether the request being answered is from the native app's window, by its credential. 44.79. */
export function fromNativeWindow(): boolean {
    return carriesWindowCredential(request())
}

/** Keeps `given` as the window's latest request, where it carries the window's credential. 44.100. */
export function noteWindow(given: Request, app: AnsweringApp): void {
    if (!carriesWindowCredential(given)) return
    WINDOW.asker = askerOf(given)
    WINDOW.app = app
}

/** 44.100 — the app a conversation runs through before the window has made a request of it. */
export function noteBooted(app: AnsweringApp): void {
    if (WINDOW.asker === undefined) WINDOW.app = app
}

/** The app the window's latest request reached, or the one booted last. 44.100. */
export function windowApp(): AnsweringApp | undefined {
    return WINDOW.app
}

/**
 * The window's latest request, or — 44.100, before it has made one — a request carrying the window's
 * credential, which the process minted and so holds before the window does, and a caller of its own.
 * `undefined` outside the native app.
 */
export function windowAsker(): Request | undefined {
    if (WINDOW.asker !== undefined) return WINDOW.asker
    const credential = windowCredential()
    if (credential === undefined || WINDOW.app === undefined) return undefined
    WINDOW.caller ??= randomToken(16, 'hex')
    return new Request('http://localhost/', {
        headers: {
            cookie: `${NATIVE_COOKIE}=${credential}; ${CALLER_COOKIE}=${WINDOW.caller}`,
        },
    })
}
