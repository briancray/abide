// THE APP'S SHAPE — what `createApp` is handed, and what a route is.
//
// Declared here rather than inside `router.ts` because it is a TYPE, not a stage of the request
// pipeline, and almost everything that wants it wants ONLY the type: 24 modules import from
// `router.ts` and half of them do so for `AppConfig` alone, dragging a module that transitively
// imports ~45 others — `mcp`, `openapi`, `clientBundle`, `pages` — into a file that needed a shape.
//
// It is also what kept the WebSocket mux welded to the HTTP pipeline: the mux's only tie to `router.ts`
// was this type.

import type { ErasedSocket } from '../socket.ts'
import type { ClientBuild } from './clientBundle.ts'
import type { Rpc, StreamRead } from './makeRpc.ts'
import type { Middleware } from './middleware.ts'

// A route is anything carrying `__rpc` metadata — a value handler produces Rpc (Mutation extends it),
// a streaming handler produces StreamRead (StreamMutation extends it). The router branches on
// `__rpc.read`; `Rpc | StreamRead` covers all four verb surfaces.
// biome-ignore lint/suspicious/noExplicitAny: existential route type — the registry erases each rpc's concrete Args/T; `unknown` breaks assignability through RpcMeta's invariant Args.
export type Route = Rpc<any, any> | StreamRead<any, any>

// THE ONE WAY TO RESOLVE AN RPC NAME. `routes` is an ordinary object literal (`loadApp` builds one, so
// does every hand-written config), so a plain `routes[name]` index also resolves `Object.prototype` —
// `constructor`, `toString`, `hasOwnProperty`, `__proto__`. Every `route === undefined` check downstream
// then read as "found", and the consequences ran in two directions at once: `handleRpcRoute` reached for
// `route.__rpc.method` on a function and answered **500** for what is plainly a 404, firing the app's
// `onError` for a request that was never the app's fault; and `allowedMethodsFor` saw `__rpc === undefined`
// and fell back to ANY_RPC_METHOD, so the method gate — the thing `auth.md` §AU8 rests the SameSite=Lax
// argument on — admitted every verb on those names.
//
// An own-property test rather than a `null`-prototype map, because the map arrives from callers this module
// does not construct (`createTestApp`, a hand-built config), and a guarantee only one construction site
// makes is not one the lookup can rely on.
export function routeFor(config: AppConfig, name: string): Route | undefined {
    const routes = config.routes
    if (routes === undefined || !Object.hasOwn(routes, name)) return undefined
    return routes[name]
}

export interface AppConfig {
    // The project root, set by the file-based loader (`loadApp`). Two consumers, both filesystem-relative:
    // `src/ui/public/**` static serving, and the client bundle's `external` list (which is derived from
    // that same directory). Absent for hand-built configs — those have no project on disk, so both
    // features simply stay off rather than guessing a cwd.
    dir?: string
    // BP1.7: `src/ui/public/**` EMBEDDED in a `abide compile` executable — request path (`/favicon.ico`)
    // → the path Bun's asset embedding gave the file inside the binary. Set only by a compiled binary,
    // where `dir` names a source tree that isn't on the machine; when present it REPLACES the
    // filesystem lookup (a standalone binary answers only for what it carries).
    publicFiles?: Record<string, string>
    routes?: Record<string, Route>
    middleware?: Middleware[]
    sockets?: Record<string, ErasedSocket>
    // M5a: page.abide sources keyed by exact request path (e.g. '/' → "<h1>…</h1>"). A GET/HEAD nav
    // request matching a page path is SSR'd to a full HTML document. File-based page discovery is M5b.
    pages?: Record<string, string>
    // TODO #7: layout.abide sources keyed by the directory route prefix they wrap (e.g. '/' → the root
    // layout, '/admin' → the admin-subtree layout). A page's applicable layouts (root → nearest) wrap it
    // outer→inner, each rendering the next level where it calls `{children()}`. See internal/layouts.ts.
    layouts?: Record<string, string>
    // TODO #20: absolute source DIRECTORY of each page/layout `.abide` file, keyed the same as
    // `pages`/`layouts`. Populated by the file loader; used only by the client bundle to resolve a
    // page's RELATIVE CSS imports (`import "./styles.css"`) to absolute paths so `Bun.build` (running
    // from a tmpdir entry) can find them. Absent for hand-built configs (no relative CSS to resolve).
    pageDirs?: Record<string, string>
    layoutDirs?: Record<string, string>
    // BP3: listen port for `Bun.serve`. Absent → 0 (ephemeral, e.g. createTestApp / hand-built configs).
    // The CLI's `serve` always resolves a concrete port (`--port` / `PORT` / 3000, dev hops to the next open one).
    port?: number
    // BP2.3: dev-only JS injected as an inline `<script>` into every SSR'd page document — the
    // live-reload client that subscribes to the reserved dev-reload channel on the socket mux and
    // reloads the page on signal. Absent in production; set only by `abide dev`.
    devReloadScript?: string
    // BP1: production vs development build. Set explicitly by the CLI — `abide dev` → true, `abide
    // build`/`abide start` → false. Absent for tests/`createTestApp`/hand-built configs. Gates client-
    // bundle MINIFICATION: only an explicit production build (`dev === false`) minifies, so dev stays
    // fast + readable and tests keep their unminified assertions (TODO #6). See clientBundle.ts.
    dev?: boolean
    // BP3: a PRE-BUILT client loaded from `dist/_app/<hash>/` (by `abide start`). When set, the router
    // serves these artifacts as-is and NEVER runs `Bun.build` at request time — production serves the
    // exact output of `abide build`. Absent in dev/test → the client is built in-memory on first use.
    clientBuild?: ClientBuild
    // CO2.4: the app-defined health hook (`src/app.ts` export `onHealth`). Takes no args and returns the
    // fields merged over the framework baseline (`{ reachable, version, startedAt, uptime }`) — app
    // fields win, so it can force `reachable: false`. A thrown hook (or a returned `reachable: false`)
    // makes the endpoint answer 503; a non-object return is ignored. Unlike onStart/onStop it is not
    // lifecycle, so it lives here — but the router no longer CALLS it: `createApp` hands it to
    // `provideHealthSource`, and `health()` composes the document for the route and for an in-proc
    // caller alike. Inside `GET /__abide/health` that call is still in request scope, so the hook still
    // reads `identity()`/`context()`.
    // Explicitly `| undefined` (not just optional): `abide dev` reassigns it on every reload, and an app
    // that DROPS its hook has to be able to write the absence back under exactOptionalPropertyTypes.
    onHealth?: (() => unknown | Promise<unknown>) | undefined
    // The app-defined error hook (`src/app.ts` export `onError`). Runs INSIDE request scope when the
    // middleware/dispatch chain THROWS an UNEXPECTED error. A deliberate `error(...)`/`redirect(...)` also
    // throws, but carries `HttpError`/`Redirect` and is rendered at its own status before this hook, so it
    // never reaches here — a declared 404 is not a bug and must not fire the app's error hook.
    // May return a `Response` to shape what the
    // client gets; returning nothing falls back to a generic 500. A throwing onError is itself caught
    // and falls back to 500. This is the outermost net for genuine bugs — not a substitute for
    // middleware auth or typed errors.
    // Returns `unknown` (like onHealth) so any handler shape is accepted — return a `Response` to shape
    // the reply, or nothing to fall back to the generic 500. handleUncaught narrows via `instanceof`.
    // Runs in request scope, so the request/route/identity are read ambiently (request(), route(), …).
    onError?: (error: unknown) => unknown
}
