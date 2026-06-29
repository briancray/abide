import type { Server } from 'bun'

/*
Optional hooks exported from src/app.ts. All hooks are optional; defaults
kick in when an export is missing. init returns an optional cleanup
function that runs on SIGINT/SIGTERM. handle is single-middleware with
next so user code can mutate the response or branch on the URL.

WebSockets are not exposed here — abide's only native WebSocket
surface is the sockets hub (see `abide/server/socket`), multiplexed onto a
single framework-owned connection per client at `/__abide/sockets`.
Inside request scopes, the live Bun.Server is reachable via the
exported `server()` function from `abide/server/server`; `init` receives it
explicitly because it runs outside a request.
*/
// @documentation plumbing
export type AppModule = {
    /*
    Extra inbound header names to forward onto in-process rpc Requests, on
    top of abide's built-in auth/identity set (cookie, authorization, the
    x-forwarded-* hints). Names a handler reads during SSR or an MCP call
    that aren't in the default allowlist — e.g. 'accept-language',
    'x-request-id', a custom 'x-tenant-id'. Case-insensitive.
    */
    forwardHeaders?: string[]
    init?: (ctx: {
        server: Server<unknown>
    }) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>
    handle?: (
        request: Request,
        next: (req: Request) => Promise<Response>,
    ) => Promise<Response> | Response
    handleError?: (error: unknown, request: Request) => Promise<Response> | Response
    /*
    App fields merged into the /__abide/health payload the client `health()`
    polls — e.g. `{ authenticated: await sessionValid(request) }`. Runs ahead
    of `handle` (the endpoint must answer without auth — reporting
    "authenticated: false" requires exactly that), so the request arrives
    unfiltered: cookies are readable, nothing is guaranteed valid. The
    payload is public and unauthenticated — never put secrets in it. The
    framework's identity keys (abide/name/version) win on collision; a
    thrown hook is logged and the base payload still serves, so an app bug
    can't masquerade as an unreachable server. Keep it cheap: the client
    probe times out at 5s.
    */
    health?: (request: Request) => unknown | Promise<unknown>
}
