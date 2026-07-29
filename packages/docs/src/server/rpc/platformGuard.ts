// #demo platformGuard
import { context } from 'abide/server/context'
import { error } from 'abide/server/error'
import { GET } from 'abide/server/GET'
import { request } from 'abide/server/request'

// The RPC middleware ONION, two layers deep. Each layer is `(next) => Response`; it owns the call to
// the layer beneath. `next()` runs the rest of the chain (and eventually the handler).

// Layer 1 — authorize. A read carries its args in the URL in EITHER documented form: the canonical
// `?__abide_args=<json>` blob a machine caller (the browser proxy) emits, or flat per-field params
// (`?allow=no`) for hand-testing. The reserved param is namespaced so it can never collide with a
// handler's own field. When `allow` is "no" this calls `error(403)` WITHOUT calling `next()` — and
// `error()` THROWS rather than returning a Response, which the chain renders at the status asked for.
// Either way it is a short-circuit: layer 2 and the handler never run.
const authorize = (next: () => Response | Promise<Response>) => {
    const params = new URL(request().url).searchParams
    // Flat form first as the default, then let the canonical blob win if present (same precedence the
    // router applies).
    let allow = params.get('allow') ?? 'yes'
    const raw = params.get('__abide_args')
    if (raw !== null) {
        try {
            const parsed = JSON.parse(raw) as { allow?: string }
            if (typeof parsed.allow === 'string') allow = parsed.allow
        } catch {
            // Malformed args — leave the default and let the handler's own validation handle it.
        }
    }
    if (allow === 'no') error(403, 'blocked by middleware')
    return next()
}

// Layer 2 — stamp. Reached only when layer 1 called `next()`. Records who let the request through
// into the per-request `context()` bag, then passes through to the handler.
const stamp = (next: () => Response | Promise<Response>) => {
    context().passedGuard = 'platformGuard.authorize'
    return next()
}

// The handler runs only for authorized requests; it reads back the stamp layer 2 left in context().
export default GET(
    ({ allow = 'yes' }) => {
        const bag = context()
        return {
            allow,
            passedGuard: typeof bag.passedGuard === 'string' ? bag.passedGuard : null,
        }
    },
    { middleware: [authorize, stamp] },
)
// #enddemo
