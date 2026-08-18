import { GET, page } from 'abide/server'

/**
 * The half of the policy a page carries before any middleware is reached.
 *
 * Built HERE rather than read off this response, and both reasons are the rung: an rpc answer is
 * JSON, and a policy on one is a header nothing reads — and this app DOES install `csp()`, so its own
 * documents go out under the whole thing, which is what the rung after this reads back. What a page
 * built with nothing installed says is the only way to show the part that was never asked for.
 *
 * Neither directive names a SOURCE, which is exactly why neither waits to be opted into:
 * `object-src 'none'` refuses plugin content, which no abide app has, and `base-uri 'self'` refuses a
 * `<base>` that would silently repoint every relative URL on the page. Nothing an app loads can be
 * blanked by either. Every directive that COULD is in `csp()`, and its baseline is a superset of
 * this, so installing it loses nothing here.
 */
export const whatAPageCarries = GET(() => ({
    policy: page('<p>a page with no middleware behind it</p>').headers.get('content-security-policy'),
}))
