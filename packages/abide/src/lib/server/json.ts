import { NO_STORE } from '../shared/CACHE_CONTROL_VALUES.ts'
import type { TypedResponse } from './rpc/types/TypedResponse.ts'
import { withResponseDefaults } from './runtime/withResponseDefaults.ts'

/*
JSON Response with rpc-friendly defaults — same shape as
`Response.json(data, init)`, except `Cache-Control: no-store` is set
unless the caller overrides it. Intermediary caches (browsers, CDNs,
shared proxies) shouldn't cache rpc replies by default; the framework's
own per-request cache handles in-process dedupe.

  export const getOrder = GET<{ id: string }>(async ({ id }) =>
      json(await db.getOrder(id)),
  )

The return type carries `T` as a phantom brand so the rpc helper can
infer the caller-facing `Return` from the handler body — no need to
annotate `GET<Args, Return>` just to type the response shape.

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
    return Response.json(
        data,
        withResponseDefaults(init, { 'Cache-Control': NO_STORE }),
    ) as TypedResponse<T>
}
