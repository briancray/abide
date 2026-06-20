import { NAV_HEADER } from '../shared/NAV_HEADER.ts'
import type { NavVerdict } from './runtime/types/NavVerdict.ts'

/*
The client router's SPA navigation probe: runs `path` through the server's
app.handle without a render. It's a fetch stamped with NAV_HEADER, which the page
dispatcher answers 204 once handle() has cleared it — so the round trip pays for
handle()'s auth/redirect gating, not a server render. fetch follows handle()'s
redirects server-side, so a redirected response's `url` is the final cleared
location: same-origin yields a soft client redirect (the router re-probes there),
cross-origin a full browser load. A non-OK status (handle() blocked it) or a thrown
fetch (offline) also hands off to the browser, so the server's real response —
a login page, an error page — is what renders.
*/
// @documentation plumbing
export async function probeNavigation(path: string): Promise<NavVerdict> {
    let response: Response
    try {
        response = await fetch(path, { headers: { [NAV_HEADER]: '1' } })
    } catch {
        return { kind: 'reload', url: path }
    }
    if (response.redirected) {
        const target = new URL(response.url)
        return target.origin === location.origin
            ? { kind: 'redirect', path: target.pathname + target.search }
            : { kind: 'reload', url: response.url }
    }
    if (!response.ok) {
        return { kind: 'reload', url: path }
    }
    return { kind: 'mount' }
}
