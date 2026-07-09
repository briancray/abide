import { NO_STORE } from '../shared/CACHE_CONTROL_VALUES.ts'
import { wireJsonReplacer } from '../shared/wireJsonReplacer.ts'
import type { TypedResponse } from './rpc/types/TypedResponse.ts'
import { withResponseDefaults } from './runtime/withResponseDefaults.ts'

/* The Content-Type `Response.json` sets — replicated here because the wire-encode step serializes
   with a replacer, so the body is built by hand rather than through `Response.json`. Seeds the
   default header set so an explicit caller `content-type` still wins. */
const JSON_CONTENT_TYPE = 'application/json;charset=utf-8'

/*
JSON Response with rpc-friendly defaults — same shape as
`Response.json(data, init)`, except `Cache-Control: no-store` is set
unless the caller overrides it. Intermediary caches (browsers, CDNs,
shared proxies) shouldn't cache rpc replies by default; the framework's
own per-request cache handles in-process dedupe.

  export const getOrder = GET(async ({ id }: { id: string }) =>
      json(await db.getOrder(id)),
  )

The return type carries `T` as a phantom brand so the rpc helper can
infer the caller-facing `Return` from the handler body — you type the
handler's parameter and let the body infer; there are no `<Args, Return>`
call generics (a stray one is a compile error).

For non-default cache policy pass `init.headers`; explicit
`cache-control` wins over the default.

JSON has no encoding for `undefined` — `Response.json(undefined)` throws
TypeError. `json(undefined)` instead emits 204 No Content, which
decodeResponse maps back to `undefined` on both the fetch and in-process
paths, so a handler typed `Shape | undefined` round-trips the wire. The
helper owns the 204 (a body-bearing status with no body would break the
round trip), so it wins over any `init.status`.
*/
// @documentation response
export function json<T>(data: T, init?: ResponseInit): TypedResponse<T> {
    if (data === undefined) {
        return new Response(
            undefined,
            withResponseDefaults(init, { 'Cache-Control': NO_STORE }, 204),
        ) as TypedResponse<T>
    }
    /* Wire-encode the body (ADR-0029 output path): a value-directed replacer rewrites a `Set` →
       array, a `Map` → `[K,V]` entries, and a `bigint` → digit string, so a structured return
       crosses as honest JSON rather than a lost `{}` or a 500 (plain `Response.json` throws on a
       bigint). A `Date` already rides as an ISO string via its native `toJSON`. */
    return new Response(
        JSON.stringify(data, wireJsonReplacer),
        withResponseDefaults(init, {
            'Cache-Control': NO_STORE,
            'Content-Type': JSON_CONTENT_TYPE,
        }),
    ) as TypedResponse<T>
}
