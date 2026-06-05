import type { Pages } from '../../browser/types/Pages.ts'
import { NO_STORE } from '../../shared/cacheControlValues.ts'
import { memoizeByKey } from '../../shared/memoizeByKey.ts'
import type { HttpVerb } from '../../shared/types/HttpVerb.ts'
import type { RemoteFunction } from '../../shared/types/RemoteFunction.ts'
import type { RemoteRoutes } from '../rpc/types/RemoteRoutes.ts'
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

/* The framework's 405 — `Allow` names the permitted verb(s), body and NO_STORE shared so the rpc and page branches can't drift. */
function methodNotAllowed(allow: string): Response {
    return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: allow, 'Cache-Control': NO_STORE },
    })
}

/*
Owns route dispatch: deciding, per registered URL, whether a request hits an
rpc verb, a page render, or nothing — and the method-matching that picks the
status. Page URLs (under src/browser/pages/) serve GET/HEAD by rendering; rpc
URLs (under src/server/rpc/, `/rpc/...`) dispatch to the single declared verb,
405 on method mismatch; an unregistered URL is 404. Page and rpc URLs are
disjoint by construction, so each route lands in exactly one branch.

`renderPage` is injected rather than built here: dispatch decisions (the
405/404 branches and the rpc method match) are the behaviour worth testing,
and keeping the Svelte render behind the seam lets a test exercise them with a
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
        time. Pick the first export that looks like a RemoteFunction so the
        framework stays tolerant of incidental re-exports.
        */
        return loader().then((mod) => {
            for (const value of Object.values(mod)) {
                if (typeof value === 'function' && 'method' in value && 'url' in value) {
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
            const method = req.method as HttpVerb
            if (hasRpc) {
                const fn = await loadRpc(routeUrl)
                if (fn && fn.method === method) {
                    return fn.fetch(req)
                }
                return methodNotAllowed(fn ? fn.method : '')
            }
            if (hasPage) {
                if (method !== 'GET' && method !== 'HEAD') {
                    return methodNotAllowed('GET, HEAD')
                }
                return renderPage(routeUrl, pathParams, store)
            }
            return new Response('Not Found', {
                status: 404,
                headers: { 'Cache-Control': NO_STORE },
            })
        }
    }
}
