// #demo platformScope
import { context } from 'abide/server/context'
import { cookies } from 'abide/server/cookies'
import { GET } from 'abide/server/GET'

// Per-RPC middleware writes into the per-request carrier bag; the handler reads it back. This shows
// `context()` as the hand-off between a middleware layer and the handler beneath it in the onion.
const stampContext = (next: () => Response | Promise<Response>) => {
    context().stampedBy = 'platformScope.middleware'
    context().stampedAt = 2026
    return next()
}

// Reads the request cookies (`cookies()` → Bun.CookieMap) and the middleware-stamped context bag.
// The browser sets `document.cookie` before calling, so the value round-trips server-side.
export default GET(
    ({ cookieName = 'platform_pref' }: { cookieName?: string }) => {
        const jar = cookies()
        const bag = context()
        return {
            cookieName,
            cookieValue: jar.get(cookieName) ?? null,
            cookieNames: Array.from(jar.keys()),
            stampedBy: typeof bag.stampedBy === 'string' ? bag.stampedBy : null,
            stampedAt: typeof bag.stampedAt === 'number' ? bag.stampedAt : null,
        }
    },
    { middleware: [stampContext] },
)
// #enddemo
