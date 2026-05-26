import { NO_STORE } from '../../shared/cacheControlValues.ts'
import type { TypedResponse } from './types/TypedResponse.ts'

/*
JSON Response with rpc-friendly defaults — same shape as
`Response.json(data, init)`, except `Cache-Control: no-store` is set
unless the caller overrides it. Intermediary caches (browsers, CDNs,
shared proxies) shouldn't cache rpc replies by default; the framework's
own per-request cache handles in-process dedupe.

  export const getOrder = GET<{ id: string }>(async ({ id }) =>
      json(await db.getOrder(id)),
  )

The return type carries `T` as a phantom brand so the verb helper can
infer the caller-facing `Return` from the handler body — no need to
annotate `GET<Args, Return>` just to type the response shape.

For non-default cache policy pass `init.headers`; explicit
`cache-control` wins over the default.
*/
export function json<T>(data: T, init?: ResponseInit): TypedResponse<T> {
    const headers = new Headers(init?.headers)
    if (!headers.has('cache-control')) {
        headers.set('cache-control', NO_STORE)
    }
    return Response.json(data, { ...init, headers }) as TypedResponse<T>
}
