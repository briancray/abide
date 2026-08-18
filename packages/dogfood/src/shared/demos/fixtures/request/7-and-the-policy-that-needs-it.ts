import { csp, middleware } from 'abide/server'

/**
 * What makes the nonce mean something: a `Content-Security-Policy` naming it.
 *
 * OPT-IN, and it writes only the half an app cannot — authorising abide's OWN inline script and
 * styles, which is the half only abide knows. Everything else is the app's, passed here, and merged
 * over a baseline so declaring `img-src` does not silently drop the rest of the policy.
 *
 * The rung before this is what the page had ALREADY, with none of this installed. What is added here
 * is every directive that names where a resource may be loaded from — which is also why it is opt-in,
 * since abide cannot see an app's CDN — plus the nonce. The baseline is a superset of those two, so
 * installing this takes nothing away.
 */
middleware(csp({ 'img-src': ["'self'", 'data:'] }))
