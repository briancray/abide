import type { CacheStore } from '../../../shared/types/CacheStore.ts'
import type { TraceContext } from '../../../shared/types/TraceContext.ts'

/*
Per-request state propagated through AsyncLocalStorage. Every field is
populated once at the server's fetch boundary; helpers and rpc-defined
remote functions read from it without threading arguments through user code.
The inbound request's AbortSignal is reached via `req.signal` rather than a
separate field.
*/
export type RequestStore = {
    url: URL
    req: Request
    cache: CacheStore
    /*
    W3C trace position: inbound `traceparent` continued (prefer-incoming) or a
    fresh sampled trace minted at the boundary. Read by trace()/log via the
    request-scope resolver and stamped into __SSR__ for the browser half.
    */
    trace: TraceContext
    /* Bun.nanoseconds() at scope entry — anchors log `+elapsed`, Server-Timing, and the closing record's total. */
    start: number
    /*
    The matched page route and its decoded params, set just before the page
    renders so the `page` proxy resolves them inside layout-scoped components
    during SSR. Undefined on rpc/socket requests and until a page match lands.
    */
    route?: string
    params?: Record<string, string>
    /*
    store.url with the mount base re-applied — the browser-space URL the `page`
    proxy publishes, memoized by pageUrlFromStore on first read. `url` itself
    stays app-space for routing and error-prefix matching.
    */
    pageUrl?: URL
    /*
    Set by a server-side health() read (via healthReadSlot) during this
    request's SSR pass. The renderer stamps the health payload into __SSR__
    only when set, so the client seed stays reader-driven like the poll.
    */
    healthRead?: boolean
    /*
    The request's cookie jar, materialized lazily by the first cookies() call
    and flushed to Set-Cookie headers when the scope returns. Undefined while a
    request never touches cookies, so the common path parses and emits nothing.
    */
    cookies?: Bun.CookieMap
    /*
    File parts split off a multipart/form-data body by parseArgs, grouped by
    field name, for files() to read. Files never enter the handler's args so the
    input schema keeps validating a plain object; undefined when the request
    carried no file parts.
    */
    files?: Record<string, File[]>
}
