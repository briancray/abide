// 26.5 AND 26.19 — WHICH BROWSER, as against who is using it: read off the `abide-caller` cookie, or
// minted where there is none. What the seed buffer is keyed by (41.19), and what `principal.caller`
// will read once there is a `principal`.
//
// MINTED ON A PAGE ALONE. A page is where a browser starts, and the one answer a later call has to be
// matched back to; a machine calling a handler directly has no render to be matched to and is not
// handed a cookie it never asked for.

// 26.19.
const CALLER_COOKIE = 'abide-caller'

export function callerOf(request: Request): string | undefined {
    const header = request.headers.get('cookie')
    if (header === null) return undefined
    return new Bun.CookieMap(header).get(CALLER_COOKIE) ?? undefined
}

// A fresh caller, and the `set-cookie` that hands it to the browser — set as 26.12 sets the principal
// cookie: out of reach of the page's own script, sent on a navigation from elsewhere, and only over
// https in production.
export function mintCaller(): { caller: string; cookie: string } {
    const caller = Buffer.from(
        crypto.getRandomValues(new Uint8Array(16)),
    ).toString('base64url')
    const cookie = new Bun.Cookie(CALLER_COOKIE, caller, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
    }).serialize()
    return { caller, cookie }
}
