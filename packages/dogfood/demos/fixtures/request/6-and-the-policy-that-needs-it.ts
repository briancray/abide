import { csp, type Middleware } from 'abide/server'

/**
 * What makes the nonce mean something: a `Content-Security-Policy` naming it.
 *
 * OPT-IN, and it writes only the half an app cannot — authorising abide's OWN inline script and
 * styles, which is the half only abide knows. Everything else is the app's, passed here, and merged
 * over a baseline so declaring `img-src` does not silently drop the rest of the policy.
 */
export const middleware: Middleware[] = [csp({ 'img-src': ["'self'", 'data:'] })]
