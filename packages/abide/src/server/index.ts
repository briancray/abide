// The server seam — what an app reaches through `@abide/abide/server`.
// Request handling, SSR and the rpc boundary. Nothing here may be reached from the client
// entry's static closure.
//
// THE COMPILER IS NOT HERE — it has its own #compiler seam. This module is public surface, so a
// compiler under it is one `export *` from being an app's dependency. `packages/abide/tests/compiler.test.ts` holds that apart.

import { installServer } from './installServer.ts'

// THE WHOLE ISOMORPHIC SURFACE, re-exported rather than owned. A server module imports `GET` and
// `reactive` through this one specifier — the same callable, by the same name, that `@abide/abide`
// hands a page. What only EMITTED code calls is on `@abide/abide/server/runtime` (`runtime.ts`).
export * from '#shared'
// 18.11 — one write a patch made, as a followed `GET`'s `patch` carries it.
export type { PatchOp } from '#shared/reactive/patchLog.ts'
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
// 45 — a conversation with a model, piped through a handler, and the two providers abide ships.
// 44 — what a page sends and is handed back, which the isomorphic entry carries too.
export type {
    AssistantContent,
    AssistantEvent,
    AssistantMessage,
} from '#shared/AssistantEvent.ts'
export {
    type AssistantOptions,
    assistant,
    type Provider,
    type ProviderEvent,
    type ToolAnswer,
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
// 38.82 — the props `src/launcher.abide` is rendered with.
export type { ConfigField } from './configFields.ts'
// 47 — the app's SQLite database, opened and migrated on first use.
export { database } from './database.ts'
// 42 — the app object, and 37's hooks a `<script server>` calls.
export { type App, createApp } from './createApp.ts'
// 37 — the hooks a `<script server>` and a server module call.
export {
    type ConfigDefaults,
    type ConfigOptions,
    type Env,
    type Lane,
    middleware,
    onConfig,
    onError,
    onHealth,
    onLauncher,
    onPairing,
    onPrincipal,
    onStart,
    onStop,
} from './hooks.ts'
export type { LauncherOptions } from './launcherOptions.ts'
export type { Launch } from './launcherPage.ts'
// 23.10 — whether a host answers, asked before a call to it.
export { reachable } from './reachable.ts'
export { type Component, render } from './render.ts'
// 22.1 — the request being served, the response being built for it, and the listening server.
// 22.12 — and where it came from.
export {
    type ReceivedFrom,
    request,
    requestIP,
    response,
    server,
} from './requestScope.ts'
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
// 8.31 — a `Store` in a Redis key.
export { redisStore } from './redisStore.ts'
// 8.25 — a `Store` in a `bun:sqlite` table.
export { sqliteStore } from './sqliteStore.ts'
// 24 — the trace this work belongs to.
export { trace } from './trace.ts'

// AN APP THAT IMPORTS `@abide/abide/server` IS ON A SERVER, booted or not: its own tests render, call and
// read `config` through these names without `createApp`.
installServer()
