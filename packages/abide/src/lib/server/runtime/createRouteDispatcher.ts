import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { memoizeByKey } from '../../shared/memoizeByKey.ts'
import { NAV_HEADER } from '../../shared/NAV_HEADER.ts'
import { REMOTE_FUNCTION } from '../../shared/REMOTE_FUNCTION.ts'
import type { HttpMethod } from '../../shared/types/HttpMethod.ts'
import type { RemoteFunction } from '../../shared/types/RemoteFunction.ts'
import type { Pages } from '../../ui/types/Pages.ts'
import type { RemoteRoutes } from '../rpc/types/RemoteRoutes.ts'
import { crossOriginGate } from './crossOriginGate.ts'
import { textResponse } from './textResponse.ts'
import type { RequestStore } from './types/RequestStore.ts'

type AnyRemoteFunction = RemoteFunction<unknown, unknown>

/* Resolves a matched route to a Response, given the request and its scope. */
type RouteHandler = (
    req: Request,
    pathParams: Record<string, string>,
    store: RequestStore,
) => Promise<Response>

/* Renders the page at `routeUrl` — injected so dispatch is testable without SSR. */
type RenderPage = (
    routeUrl: string,
    params: Record<string, string>,
    store: RequestStore,
) => Promise<Response>

/* The framework's 405 — `Allow` names the permitted rpc(s); body/headers come from the shared textResponse so the rpc and page branches can't drift. */
function methodNotAllowed(allow: string): Response {
    return textResponse(405, undefined, { Allow: allow })
}

/*
Owns route dispatch: deciding, per registered URL, whether a request hits an
an rpc, a page render, or nothing — and the method-matching that picks the
status. Page URLs (under src/ui/pages/) serve GET/HEAD by rendering; rpc
URLs (under src/server/rpc/, `/rpc/...`) dispatch to the single declared rpc,
405 on method mismatch; an unregistered URL is 404. Page and rpc URLs are
disjoint by construction, so each route lands in exactly one branch.

`renderPage` is injected rather than built here: dispatch decisions (the
405/404 branches and the rpc method match) are the behaviour worth testing,
and keeping the page render behind the seam lets a test exercise them with a
stub instead of booting a server. The rpc-module loader is memoised internally
so each module loads once.
*/
export function createRouteDispatcher({
    pages,
    rpc,
    renderPage,
}: {
    pages: Pages
    rpc: RemoteRoutes
    renderPage: RenderPage
}): (routeUrl: string) => RouteHandler {
    const loadRpc = memoizeByKey((url): Promise<AnyRemoteFunction | undefined> | undefined => {
        const loader = rpc[url]
        if (!loader) {
            return undefined
        }
        /*
        Each $rpc module has exactly one named export, validated at build
        time. Pick the first REMOTE_FUNCTION-branded export — exact, so an
        incidental re-export carrying method/url props can't be mistaken
        for the rpc.
        */
        return loader().then((mod) => {
            for (const value of Object.values(mod)) {
                if (typeof value === 'function' && REMOTE_FUNCTION in value) {
                    return value as AnyRemoteFunction
                }
            }
            return undefined
        })
    })

    return function buildRouteHandler(routeUrl: string): RouteHandler {
        const hasPage = pages[routeUrl] !== undefined
        const hasRpc = rpc[routeUrl] !== undefined
        return async function routeHandler(req, pathParams, store) {
            const method = req.method as HttpMethod
            if (hasRpc) {
                const fn = await loadRpc(routeUrl)
                if (fn && fn.method === method) {
                    const forbidden = crossOriginGate(req, store.url, {
                        allowReadOnly: true,
                        optOut: fn.crossOrigin === true,
                        hint: 'Declare `crossOrigin: true` on the rpc to accept cross-site calls.',
                    })
                    if (forbidden) {
                        return forbidden
                    }
                    return fn.fetch(req)
                }
                return methodNotAllowed(fn ? fn.method : '')
            }
            if (hasPage) {
                if (method !== 'GET' && method !== 'HEAD') {
                    return methodNotAllowed('GET, HEAD')
                }
                /*
                SPA navigation probe: the client router fetches the destination
                with NAV_HEADER purely so app.handle runs (auth/redirect gating)
                before it mounts the page itself. Reaching here means handle()
                already passed — it called next — so a bare 204 says "cleared,
                mount it client-side" without paying for a render. A redirect or
                block from handle() short-circuits before next and never arrives.
                */
                if (req.headers.has(NAV_HEADER)) {
                    return new Response(null, {
                        status: 204,
                        headers: { 'Cache-Control': NO_STORE },
                    })
                }
                return renderPage(routeUrl, pathParams, store)
            }
            return textResponse(404)
        }
    }
}
