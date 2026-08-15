// The server surface an APP types, and nothing else.
//
// Curated rather than collected, by the same two rules `abide.ts` follows and one more that is this
// entry point's own: WHAT THE DOCS APP COVERS IS WHAT IS PUBLIC. Every name here has its own page at
// `/docs/<name>` and at least one rung on it, and a name with no rung belongs on
// `abide/server/internal` instead. Not the `exports` map, and not what the dogfood app happens to import.
// Asserted both ways in `dogfood/test/docs.test.ts`, against `Object.keys` of this module.
//
// The line against `abide/server/internal` is drawn by WHO CALLS. `abide start` boots the process,
// dispatches to a handler and installs the request scope — so `boot`, `dispatch` and `serve` are over
// there, while the four lifecycle hooks and the five scope ambients are here. An app DECLARES; the
// CLI runs. Anyone hand-rolling a `Bun.serve` reaches the other specifier and gets the same functions
// the CLI uses, because there is no second implementation of any of it.
//
// The SSR walk itself is `render.ts`. This file held it until the split, which is why `abide/server`
// used to mean "1,200 lines with a re-export block at the bottom" rather than a list of decisions.

// The eight-faced renderer, of which exactly one is public: an async generator, which a caller
// wanting a string drains. The document and fragment faces are `abide start`'s and are on
// `abide/server/internal`.
export { render, type Renderable } from './render.ts'

// The principal, and the half only the server can supply. `identity` itself is on the isomorphic
// surface — asking is the same call anywhere — and it is re-exported here, straight from the module
// that defines it, because the handler writing a login is already importing `request()` and
// `cookies()` from this entry point.
export { type Identity, identity } from '$shared/identity.ts'
// The shape one line takes on the remote feed. The endpoint itself is `dispatch`'s — an app mounts
// that and gets `/__abide/logs` with it — but a reader of the feed needs the record to decode into.
// `Level` beside the record it is a field of. Not on `abide`, because no call there takes or returns
// one — `log.warning(...)` is a method per level rather than a level-taking call.
export type { Level, LogRecord } from '$shared/log.ts'
// What the process was TOLD: the typed environment, with the app's own defaults under it, and the
// three facts it CONCLUDES — `APP_NAME`, `APP_VERSION`, `APP_DATA_DIR`. Those three used to be
// accessors beside this (`appName()`, `appVersion()`, `appDataDir()`) and are fields now, because an
// app asks what it is called far more often than it asks which variable said so. The accessors still
// exist on `abide/server/internal`: they are what `resolve()` computes the fields FROM, so there is
// one answer rather than a published value and an honoured one.
//
// The one ambient with no wire face — half the document is a signing key — so unlike `health()` and
// `identity()` there is no isomorphic half and no endpoint to make one out of.
export {
    type Config,
    type ConfigDefaults,
    type ConfigOptions,
    type Configured,
    config,
    type Env,
    onConfig,
} from './config.ts'
// The one security header abide can help with, because the half an app cannot write — authorising
// abide's OWN inline script and styles — is the half only abide knows. Opt-in: `middleware = [csp()]`.
export { csp } from './csp.ts'
// The app's own account of whether it is working. `health()` itself is on the isomorphic surface —
// asking is the same call anywhere — and this is the half only the app being asked about can supply.
export { type HealthReporter, onHealth } from './health.ts'
export { type IdentityResolver, onIdentity } from './identity.ts'
// What every renderer here takes. `RenderContext` stays internal: it is the walk's own state, and
// its `document` field is typed by a `DocumentContext` no caller can name.
export type { RenderOptions } from './internal/emit.ts'
// The process's own lifecycle, as an app DECLARES it. The half of the CLI that boots reads these off
// an app's exports and hands each to the function of the same name; what does the running —
// `boot`, `handle`, `shutdown` — is on `abide/server/internal`, because `abide start` is what calls it.
export {
    type ErrorHook,
    type Middleware,
    middleware,
    onError,
    onStart,
    onStop,
    type Route,
    type StartHook,
    type StopHook,
} from './lifecycle.ts'
// What an app's own route answers with. Server-side because a `Response` is: the browser lane reads
// one, it never builds one.
export {
    type DataFailure,
    error,
    type Failed,
    type Failure,
    type FailureOptions,
    HttpError,
    json,
    jsonl,
    page,
    type RedirectStatus,
    redirect,
    sse,
    type TypedOptions,
} from './responses.ts'
export {
    DELETE,
    GET,
    PATCH,
    POST,
    PUT,
    type RpcMiddleware,
    type RpcOptions,
    type RpcSchemas,
    type SocketEvent,
    type SocketMiddleware,
    type SocketOptions,
    socket,
} from './rpc.ts'
// The server that is listening, as an ambient. A process fact rather than a caller's, like
// `appDataDir` above it — Bun hands the instance to `fetch(request, self)` and nowhere else, and this
// is what stops that being threaded through every layer under it.
export { type RunningServer, server } from './running.ts'
// The declared shape of what crosses a transport, as TYPES only — an app writes `{ schema }` on an
// rpc and these are what it writes it in. Server-side because an option cannot cross the wire: a
// schema is checked where the handler is, and the browser lane gets the address alone. Running that
// check is `respond`'s, so `validateJson` and `SCHEMA_ERROR` are on `abide/server/internal`.
export type {
    EndpointShape,
    Issue,
    JsonSchema,
    JsonType,
    Schema,
    SchemaRefusal,
    Shapes,
    StandardSchemaV1,
} from './schema.ts'
// The caller scope, as an app READS it. `serve` is what installed it and is on
// `abide/server/internal` beside the rest of what `abide start` does.
export { bag, cookies, nonce, request, type Trace, trace } from './scopes.ts'
