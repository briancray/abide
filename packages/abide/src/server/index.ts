// The server seam — what an app reaches through `abide/server`.
// Request handling, SSR and the rpc boundary. Nothing here may be reached from the client
// entry's static closure.
//
// THE COMPILER IS NOT HERE — it has its own #compiler seam. This module is public surface, so a
// compiler under it is one `export *` from being an app's dependency. `packages/abide/tests/compiler.test.ts` holds that apart.

import { installServer } from './installServer.ts'

// THE WHOLE ISOMORPHIC SURFACE, re-exported rather than owned. A server module imports `GET` and
// `reactive` through this one specifier — the same callable, by the same name, that `abide`
// hands a page. It is also every run-time half an
// emitted module reaches through here: 32.1's escaping and 32.2's `raw`, which both sides render
// markup with, 32.20's `safeUrl`, and 31.8's `writePath`.
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
// 18 — a value carried over a web socket.
export {
    type Socket,
    type SocketEvent,
    type SocketOptions,
    socket,
} from '#shared/socket.ts'
// 45 — a conversation with a model, piped through a handler, and the two providers abide ships.
export {
    type AssistantEvent,
    type AssistantMessage,
    type AssistantOptions,
    assistant,
    type Provider,
    type Toolbox,
    type ToolDefinition,
} from './assistant.ts'
export { type ClaudeApiConfig, claudeApi } from './claudeApi.ts'
export {
    type BridgeStatus,
    type ClaudeCodeConfig,
    claudeCode,
} from './claudeCode.ts'
// 27 — the resolved configuration.
export { type Config, config } from './config.ts'
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
// 23.10 — whether a host answers, asked before a call to it.
export { reachable } from './reachable.ts'
export { type Component, render, type Shell } from './render.ts'
// 32.17's run-time half: one invocation, rendered where it stands, with the anchors that make the
// child's markup one thing for the client to walk to.
export { renderComponent } from './renderComponent.ts'
// 22.1 — the request being served, the response being built for it, and the listening server.
export { request, response, server } from './requestScope.ts'
// 17 — the response helpers, each a write through `response`.
export {
    bytes,
    json,
    jsonl,
    page,
    type RedirectStatus,
    redirect,
    sse,
    type Values,
} from './responseHelpers.ts'
// 24 — the trace this work belongs to.
export { trace } from './trace.ts'

// AN APP THAT IMPORTS `abide/server` IS ON A SERVER, booted or not: its own tests render, call and
// read `config` through these names without `createApp`.
installServer()
