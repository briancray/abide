import { basePath } from '../shared/basePath.ts'
import { forwardHeaders } from '../shared/forwardHeaders.ts'
import type { PageRoutes, PathParams } from '../shared/url.ts'
import { url } from '../shared/url.ts'
import { getActiveServer } from './runtime/getActiveServer.ts'
import { pageRenderSlot } from './runtime/pageRenderSlot.ts'
import { requestContext } from './runtime/requestContext.ts'

/* Query args carried onto the rendered URL — the same shape url() appends. */
type Query = Record<string, string | number | boolean | undefined>

/*
Renders a page route to its HTML string, server-side, from anywhere in a request
scope — the same pipeline (app.html shell, layout chain, params, inline rpc
reads) an HTTP GET of that URL would run, so the page stays directly linkable and
its emailed form is one call away. Argument shape mirrors url()/navigate: a route
literal with `[name]` segments takes its params first (`render('/emails/[id]',
{ id })`), then optional query; a paramless route takes optional query directly.

The page renders in a fresh nested request scope (like an in-process rpc call), so
its own `cache()`/rpc reads resolve exactly as under a live request; app.handle
middleware and gzip are not applied. A page whose content is baked inline —
top-level `await` or a blocking `{#await expr then value}` — returns complete,
self-contained HTML. A page with streaming `{#await}` blocks returns the shell
plus trailing `<abide-resolve>` fragments a browser reassembles client-side, so
for a no-JS surface (email) use blocking awaits.
*/
// @documentation render
export function render<P extends keyof PageRoutes | (string & {})>(
    path: P,
    ...args: keyof PathParams<P> extends never
        ? [query?: Query]
        : [params: PathParams<P>, query?: Query]
): Promise<string>
export async function render(path: string, first?: Query, second?: Query): Promise<string> {
    const dispatch = pageRenderSlot.render
    if (!dispatch) {
        throw new Error(
            '[abide] render() called before init — make sure your call happens inside or after app.ts init() resolves',
        )
    }
    /* url() discriminates params-vs-query off the path's own segments at runtime;
       cast past its typed overload since `path` is a plain string here. */
    const resolved = (url as (path: string, first?: Query, second?: Query) => string)(
        path,
        first,
        second,
    )
    /* url() prefixes the mount base for browser-facing links; strip it back off so
       the pathname matches the base-less page route keys the resolver matches on. */
    const base = basePath()
    const routePath =
        base && resolved.startsWith(base) ? resolved.slice(base.length) || '/' : resolved
    /* Origin only shapes absolute-URL generation inside the page; the live server's
       own origin when booted, a stable localhost otherwise. */
    const origin = getActiveServer()?.url.origin ?? 'http://localhost'
    const requestUrl = new URL(routePath, origin)
    /* Called inside a request scope, inherit the caller's auth/identity context —
       the same allowlisted cookies/authorization/trace/forwarded headers defineRpc
       threads onto an in-process rpc, cached per scope. Outside a scope (a cron/CLI
       render) the page renders with no forwarded headers. */
    const store = requestContext.getStore()
    let headers: Headers | undefined
    if (store) {
        store.forwardedHeaders ??= forwardHeaders(store.req.headers)
        headers = store.forwardedHeaders
    }
    const response = await dispatch(new Request(requestUrl, { headers }), requestUrl)
    return response.text()
}
