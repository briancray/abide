import type { CacheStore } from '../../../shared/types/CacheStore.ts'
import type { PendingAsyncCells } from '../../../shared/types/PendingAsyncCells.ts'
import type { ResolvedCells } from '../../../shared/types/ResolvedCells.ts'
import type { TraceContext } from '../../../shared/types/TraceContext.ts'
import type { Scope } from '../../../ui/types/Scope.ts'

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
    In-flight async-cell promises registered during this request's SSR pass. The
    Tier-2 barrier (`settleAsyncCells`) drains and awaits them between a
    component's cell declarations and its template so resolved values bake into
    the HTML. Per-request (like `cache`) so concurrent renders never share a drain.
    */
    pendingAsyncCells: PendingAsyncCells
    /*
    Async-cell values that RESOLVED during this request's SSR pass, keyed by render-path id.
    `createAsyncCell.settleValue` pushes each; the page renderer stamps them into `__SSR__.cells`
    (ref-json) so the client hydrates the cell warm. Sibling of `pendingAsyncCells` (the barrier's
    in-flight list) — this one holds settled VALUES, read at render-return, not awaited.
    */
    resolvedCells: ResolvedCells
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
    /*
    The allowlisted headers forwarded onto in-process rpc Requests during this
    request's SSR pass — derived once from the inbound headers (which don't change
    within the scope) and reused by every defineRpc call. Each call clones it,
    since buildRpcRequest mutates the Headers (content-type/ref-json) before
    constructing the Request. Undefined until the first in-process rpc.
    */
    forwardedHeaders?: Headers
    /*
    The body class of the response the dispatch pipeline produced, stashed so
    runWithRequestScope's closing-record stream monitor reuses the single S2
    classification instead of re-deriving from the Content-Type. Undefined for
    callers that don't classify (mcp, the fetch fallback, tests) — those fall
    back to classifying the response themselves.
    */
    responseStreaming?: boolean
    /*
    The request's ambient lexical scope during its SSR pass — the backing for
    `CURRENT_SCOPE.current` under the server's ALS-backed holder
    (installAmbientScopeStore). Keeping it per-request isolates the ambient across
    the inline `await`s a render suspends on, so concurrent renders don't clobber
    one shared module global. Undefined until the render enters its first scope.
    */
    currentScope?: Scope
    /*
    The request's ambient RENDER-PATH during its SSR pass — the backing for
    `CURRENT_PATH.current` (the serialization-stable lexical id the SSR pass composes
    to key a cell's warm-seed value). Per-request for the same reason as `currentScope`:
    a render awaits inline while its path is set. Undefined → the empty root.
    */
    currentPath?: string
}
