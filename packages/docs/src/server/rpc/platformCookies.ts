// #demo platformCookies
import { cookies } from 'abide/server/cookies'
import { GET } from 'abide/server/GET'

// `cookies()` returns the request's `Bun.CookieMap`. The browser sets `document.cookie`; this RPC reads
// it back server-side, so the value round-trips through the request scope.
export default GET(({ cookieName = 'platform_pref' }: { cookieName?: string }) => {
    const jar = cookies()
    return {
        cookieName,
        cookieValue: jar.get(cookieName) ?? null,
        cookieNames: Array.from(jar.keys()),
    }
})
// #enddemo
