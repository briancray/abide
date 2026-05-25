import type { Server } from 'bun'

/*
Optional hooks exported from src/app.ts. All hooks are optional; defaults
kick in when an export is missing. init returns an optional cleanup
function that runs on SIGINT/SIGTERM. handle is single-middleware with
next so user code can mutate the response or branch on the URL.

WebSockets are not exposed here — belte's only native WebSocket surface
is SOCKET-bound rpc (see `belte/route`), multiplexed onto a single
framework-owned connection per client at `/__belte/socket`. Inside
request scopes, the live Bun.Server is reachable via the exported
`server` proxy from `belte/server`; `init` receives it explicitly
because it runs outside a request.
*/
export type AppModule = {
    init?: (ctx: {
        server: Server<unknown>
    }) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>
    handle?: (
        request: Request,
        next: (req: Request) => Promise<Response>,
    ) => Promise<Response> | Response
    handleError?: (error: unknown, request: Request) => Promise<Response> | Response
}
