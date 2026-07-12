import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { matchRoute } from '../../shared/matchRoute.ts'
import { normalizePathname } from '../../shared/normalizePathname.ts'
import { parseRouteSegments } from '../../shared/parseRouteSegments.ts'
import type { Pages } from '../../ui/types/Pages.ts'
import type { RemoteRoutes } from '../rpc/types/RemoteRoutes.ts'
import type { createRouteDispatcher } from './createRouteDispatcher.ts'

/* A route handler pre-bound to one registered URL — the dispatcher's output. */
type RouteHandler = ReturnType<ReturnType<typeof createRouteDispatcher>>

/*
The URL-shape decision for one request, once the framework plumbing has passed
on it. A `handler` case (rpc, page, or the openapi doc) is dispatched through
the request scope; a `redirect` is returned verbatim; the asset cases name
which asset server serves the path, with `publicAsset` as the catch-all bucket
whose miss falls through to the 404 path. Keeping the decision data-only lets a
test assert it without booting Bun.serve — the effects (ALS dispatch, asset
serving, 404 render) stay in the fetch closure.
*/
export type RouteResolution =
    | { kind: 'redirect'; response: Response }
    | { kind: 'handler'; handler: RouteHandler; params: Record<string, string> }
    | { kind: 'appAsset' }
    | { kind: 'publicAsset' }

/*
Owns the URL-shape decisions that used to sit inline in the Bun.serve fetch
closure: canonical-slash redirects (308), the openapi document's build +
memo, and the asset-precedence ordering. Route dispatch (rpc-vs-page-vs-404,
method matching) stays behind createRouteDispatcher; this resolver composes its
per-URL handlers and adds the request-URL → decision layer on top, so both the
redirect logic and the memo semantics become unit-testable without a listener.

App routes are matched AFTER the `/__abide/*` plumbing (a reserved namespace no
app route occupies) and BEFORE the root-level framework surfaces (the openapi
doc, `/_app/`, public/ files), so a page route shadows a same-path public file
— the precedence the Bun routes table used to impose implicitly, now pinned
here. rpc URLs are flat literals (always `/rpc/...`) resolved by direct lookup;
page URLs carry `[name]` / `[[name]]` / `[...rest]` segments resolved through
the shared matchRoute — the same matcher the client router runs — so params
decode and precedence agree across the sides by construction.
*/
export function createAppRouteResolver({
    pages,
    rpc,
    buildRouteHandler,
    openApiPath,
    buildOpenApiDocument,
}: {
    pages: Pages
    rpc: RemoteRoutes
    buildRouteHandler: ReturnType<typeof createRouteDispatcher>
    openApiPath: string
    buildOpenApiDocument: () => Promise<Record<string, unknown>>
}): (req: Request, url: URL) => RouteResolution {
    /* Handlers pre-bound per registered URL. rpc URLs dispatch by direct lookup;
       page URLs resolve through matchRoute against pageRouteUrls below. */
    const rpcHandlers = new Map<string, RouteHandler>()
    for (const routeUrl of Object.keys(rpc)) {
        rpcHandlers.set(routeUrl, buildRouteHandler(routeUrl))
    }
    const pageHandlers = new Map<string, RouteHandler>()
    for (const routeUrl of Object.keys(pages)) {
        /* A `[...rest]` consumes every remaining segment, so segments after it
           can never constrain matching — the route would silently serve paths
           it shouldn't. Fail at boot instead. */
        const segments = parseRouteSegments(routeUrl)
        const catchAllIndex = segments.findIndex(
            (segment) => segment.kind === 'param' && segment.catchAll,
        )
        if (catchAllIndex !== -1 && catchAllIndex !== segments.length - 1) {
            throw new Error(
                `[abide] invalid page route ${routeUrl}: a [...name] catch-all must be the last segment`,
            )
        }
        pageHandlers.set(routeUrl, buildRouteHandler(routeUrl))
    }
    const pageRouteUrls = Object.keys(pages)

    /* Built on first request, then reused — the rpc registry is frozen after load.
       Memoised as a promise so two concurrent cold requests share one build instead
       of both building (the second otherwise clobbering the first). A rejected build
       clears the memo so the next request retries rather than caching the failure. */
    let openApiSpec: Promise<Record<string, unknown>> | undefined
    const openApiHandler: RouteHandler = async () => {
        openApiSpec ??= buildOpenApiDocument().catch((error) => {
            // Don't cache a failed build — clear the memo so a later request
            // retries instead of 500-ing forever.
            openApiSpec = undefined
            throw error
        })
        return Response.json(await openApiSpec, { headers: { 'Cache-Control': NO_STORE } })
    }

    return function resolveAppRoute(_req, url): RouteResolution {
        const rpcHandler = rpcHandlers.get(url.pathname)
        if (rpcHandler) {
            return { kind: 'handler', handler: rpcHandler, params: {} }
        }
        /*
        Pages match only in canonical slash form; a non-canonical request
        (`/admin/`, `//admin`) that would match is 308'd to the canonical URL
        instead of served. Serving it directly would hand app.handle — the auth
        seam — a pathname the matcher silently normalized away, so an exact-match
        guard on `/admin` never sees the request it's guarding (the old Bun routes
        table 404'd these forms; the redirect keeps the guard sound AND the URL
        friendly). rpc URLs stay exact-match strict, as they always were.
        */
        const canonicalPathname = normalizePathname(url.pathname)
        if (canonicalPathname !== url.pathname) {
            if (matchRoute(pageRouteUrls, canonicalPathname)) {
                return {
                    kind: 'redirect',
                    response: new Response(null, {
                        status: 308,
                        headers: {
                            Location: `${canonicalPathname}${url.search}`,
                            'Cache-Control': NO_STORE,
                        },
                    }),
                }
            }
        } else {
            const matchedPage = matchRoute(pageRouteUrls, url.pathname)
            if (matchedPage) {
                const pageHandler = pageHandlers.get(matchedPage.route)
                if (pageHandler) {
                    return { kind: 'handler', handler: pageHandler, params: matchedPage.params }
                }
            }
        }
        if (url.pathname === openApiPath) {
            return { kind: 'handler', handler: openApiHandler, params: {} }
        }
        /* Static assets sidestep ALS + the per-request CacheStore + app.handle
           (see the fetch closure); `/_app/` build output takes precedence over
           public/ files, and anything else falls to the public bucket whose miss
           becomes the 404. */
        if (url.pathname.startsWith('/_app/')) {
            return { kind: 'appAsset' }
        }
        return { kind: 'publicAsset' }
    }
}
