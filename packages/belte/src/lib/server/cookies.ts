import { requestContext } from './runtime/requestContext.ts'

/*
The cookie jar for the in-flight request. Reads parse the inbound `Cookie`
header; writes (`set` / `delete`) are collected and flushed to the response as
`Set-Cookie` headers when the handler returns (see runWithRequestScope). Backed
by Bun's native `CookieMap`, so it's a live `Map<string, string>` plus
`.set(name, value, options)` carrying the standard attributes (httpOnly, secure,
sameSite, maxAge, path, …) and `.delete(name)` for expiry:

  const jar = cookies()
  const session = jar.get('session')                       // read inbound
  jar.set('session', token, { httpOnly: true, sameSite: 'lax' })
  jar.delete('session')                                     // expire on the way out

Materialized lazily on first call and cached on the request store, so a request
that never touches cookies parses nothing and emits no `Set-Cookie`. Throws
outside a request scope, like request().
*/
export function cookies(): Bun.CookieMap {
    const store = requestContext.getStore()
    if (!store) {
        throw new Error(
            '[belte] cookies() called outside a request scope — it only resolves while an SSR render or rpc handler is in flight',
        )
    }
    store.cookies ??= new Bun.CookieMap(store.req.headers.get('cookie') ?? '')
    return store.cookies
}
