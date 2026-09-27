// The server seam — what an app reaches through `abide/server`.
// Request handling, SSR and the rpc boundary. Nothing here may be reached from the client
// entry's static closure.
//
// THE COMPILER IS NOT HERE — it has its own #compiler seam. This module is public surface, so a
// compiler under it is one `export *` from being an app's dependency. `packages/abide/tests/compiler.test.ts` holds that apart.

// THE WHOLE ISOMORPHIC SURFACE, re-exported rather than owned. A server module imports `GET` and
// `reactive` through this one specifier — the same callable, by the same name, that `abide`
// hands a page. It is also every run-time half an
// emitted module reaches through here: 32.1's escaping and 32.2's `raw`, which both sides render
// markup with, 32.21's `safeUrl`, and 31.8's `writePath`.
export * from '#shared'
export {
    type Clients,
    DELETE,
    GET,
    PATCH,
    POST,
    PUT,
    type Rpc,
    type RpcOptions,
} from '#shared/rpc.ts'
// 27 — the resolved configuration.
export { type Config, config } from './config.ts'
// 25 — the account of the app.
export { type Health, health } from './health.ts'
// 42 — the app object, and 37's hooks an `src/server/app.ts` calls.
export { type App, createApp } from './createApp.ts'
export {
    type ConfigDefaults,
    type ConfigOptions,
    type Env,
    middleware,
    onConfig,
    onError,
    onHealth,
    onPrincipal,
    onStart,
    onStop,
} from './hooks.ts'
export { type Component, render, type Shell } from './render.ts'
// 18 — a value carried over a web socket.
export {
    type Socket,
    type SocketEvent,
    type SocketOptions,
    socket,
} from '#shared/socket.ts'
// 17 — the response helpers, each a write through `response`.
export {
    bytes,
    jsonl,
    page,
    type RedirectStatus,
    redirect,
    sse,
    type Values,
} from './responseHelpers.ts'
// 32.18's run-time half: one invocation, rendered where it stands, with the anchors that make the
// child's markup one thing for the client to walk to.
export { renderComponent } from './renderComponent.ts'
// 22.1 — the request being served, the response being built for it, and the listening server.
export { request, response, server } from './requestScope.ts'
// 24 — the trace this work belongs to.
export { trace } from './trace.ts'
