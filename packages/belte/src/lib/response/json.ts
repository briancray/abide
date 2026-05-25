/*
JSON Response with rpc-friendly defaults — same shape as
`Response.json(data, init)`, except `Cache-Control: no-store` is set
unless the caller overrides it. Intermediary caches (browsers, CDNs,
shared proxies) shouldn't cache rpc replies by default; the framework's
own per-request cache handles in-process dedupe.

  export const getOrder = GET<{ id: string }, Order>(async ({ id }) =>
      json(await db.getOrder(id)),
  )

For non-default cache policy pass `init.headers`; explicit
`cache-control` wins over the default.
*/
export function json<T>(data: T, init?: ResponseInit): Response {
    const headers = new Headers(init?.headers)
    if (!headers.has('cache-control')) {
        headers.set('cache-control', 'no-store')
    }
    return Response.json(data, { ...init, headers })
}
