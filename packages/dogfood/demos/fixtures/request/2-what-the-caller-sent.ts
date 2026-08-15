import { cookies, GET, request } from 'abide/server'

/**
 * The `cookie` header parsed once and held on the scope, as an ordinary `Map`.
 *
 * Parsed on the FIRST ask rather than on every request, so a route that never reads one pays
 * nothing. A `Map` and not a bespoke type because `bag()` and `trace().state` are the same shape —
 * a third spelling for "a store that lives as long as this request" is a third thing to remember.
 */
export const catalogue = GET(() => ({
    theme: cookies().get('theme') ?? 'light',
    agent: request().headers.get('user-agent') ?? 'unknown',
}))
