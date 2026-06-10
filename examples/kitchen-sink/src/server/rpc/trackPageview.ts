import { json } from '@belte/belte/server/json'
import { POST } from '@belte/belte/server/POST'
import { z } from 'zod'

const inputSchema = z.object({ pageUrl: z.string() })

const pageviews = new Map<string, number>()

/*
A public beacon any third-party page may POST from its own origin. By default
the router 403s a mutating browser request whose Origin doesn't match the
app's own host — the no-preflight CSRF shapes — before the handler runs;
`crossOrigin: true` exempts this one verb from that same-origin mutation
gate. The opt-out is deliberate and safe here because the handler reads no
cookies and trusts nothing ambient, so a cross-site call can't ride a
visitor's session. Demonstrated live at /security.
*/
export const trackPageview = POST(
    ({ pageUrl }) => {
        const count = (pageviews.get(pageUrl) ?? 0) + 1
        pageviews.set(pageUrl, count)
        return json({ pageUrl, count })
    },
    { inputSchema, crossOrigin: true },
)
