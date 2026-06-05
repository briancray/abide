import type { CacheStore } from '../../../shared/types/CacheStore.ts'

/*
Per-request state propagated through AsyncLocalStorage. Every field is
populated once at the server's fetch boundary; helpers and verb-defined
remote functions read from it without threading arguments through user code.
The inbound request's AbortSignal is reached via `req.signal` rather than a
separate field.
*/
export type RequestStore = {
    url: URL
    req: Request
    cache: CacheStore
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
