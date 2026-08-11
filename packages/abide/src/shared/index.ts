// The isomorphic surface: three primitives, one template tag, same import on both sides.
//
//   state   — own      a value
//   memo    — derive or load one (args declared = cache key; no args = inferred from the body)
//   channel — subscribe to them
//
// The two RENDERERS are separate entry points (`abide/ui`, `abide/server`) because only one of them
// ships to a browser. Nothing here imports either, so a page pays for the renderer it uses.
//
// What only the COMPILER writes is on `abide/runtime` — `classes`, `styles`, `adopt`, `awaited`,
// `boundary`, `streamed`, `raw`, `keyed`, `remote`, `remoteSocket`. This file is what an author TYPES,
// and `html` is the only one of the ten on both sides of that line.

export { type Channel, type ChannelOptions, channel, type KeyedChannel } from './channel.ts'
// The app's own account of whether it is working, asked the same way on both sides. `useHealthSource`
// is deliberately absent: it is how `abide/server` installs the LOCAL answer — the same shape as the
// app-name source under `log` — and a caller installing one would be answering for an app it is not.
export { type Health, health } from './health.ts'
// The five block classes are exported as TYPES only. Each has a lowercase factory beside it, which is
// the whole of how one is built — `new Awaited(...)` is not a spelling anything uses, here or in an
// app, and every consumer inside the package reaches the class through `$shared/html.ts` directly.
// `KEY` went the same way: `keyed()` writes the brand and `isKeyed()` reads it.
export {
    type Awaited,
    type Boundary,
    type Branches,
    classifySlots,
    escape,
    html,
    isKeyed,
    isTemplate,
    type Keyed,
    props,
    type Raw,
    type SlotKind,
    type Streamed,
    type Suspend,
    suspend,
    type TemplateResult,
} from './html.ts'
// Who the server decided this caller is, asked the same way on both sides. `useIdentitySource` is
// absent for the reason `useHealthSource` is, and the two WRITERS on `identity` throw in a browser
// rather than being missing from it: a client that could set its own principal is a client that
// guesses one, and one call shape on both sides is what makes that a message rather than a mystery.
export { type Identify, type Identity, identity } from './identity.ts'
// Per-caller storage. A client never needs it — there is one caller, forever — but the same import
// works there, and it is what a test uses to prove two callers do not share a memo's cache.
export { isolate } from './internal/scopes.ts'
// A DECLARED failure, as it is caught — the type `fn(args).isError(e, name)` narrows to, and the one
// a hand-written stub names to say what an endpoint refuses with. Isomorphic because a failure is:
// the DECLARING half is `error.typed` in `abide/server`, and this is what crosses.
export type { Failed } from './internal/wire.ts'
// The console, on both sides. The DEFAULT channel is the app's own output and always writes; a NAMED
// channel is off unless `DEBUG` names it — except `warning` and `error`, which the gate never
// swallows, because the gate is there to control volume rather than to hide breakage. `abideLog` and
// `useAppNameSource` are deliberately absent: the first is the framework's own channel and the second
// is how `abide/server` installs the package.json fallback under `ABIDE_APP_NAME`.
export { type Level, type Logger, log } from './log.ts'
export {
    // Tags name DATA, not the thing holding it, so these are module-level verbs: they reach every
    // slot carrying the tag without the caller knowing which memo that is.
    invalidate,
    type KeyedMemo,
    type MemoHandle,
    type MemoOptions,
    memo,
    refresh,
    type TagSelector,
} from './memo.ts'
// The second REACTIVE ambient, and reactive for the same reason `route()` is: connectivity changes
// without a new caller arriving, so a probe answering only on the next ask would leave an offline
// banner up after the network came back.
export { online } from './online.ts'
export { type Cell, type Memo, type State, scope, state, untrack, watch } from './reactive.ts'
// Routing. `route()` is an ambient like `request()`, but a reactive one — a client moves without a
// new caller arriving. `useHrefSource`, `useHistorySink` and `useNavigationSink` are deliberately
// absent: they are how the two lanes install their own edge of it — `abide/server` the request's URL,
// the same way it installs the scope source, and `abide/ui` the document's address bar and the part a
// served navigation repaints — and nothing else may reach any of them.
export {
    type Loader,
    type NavigateOptions,
    navigate,
    outlet,
    type Params,
    type Route,
    type RouteEntry,
    type RouteKind,
    ready,
    route,
    routes,
    url,
    type View,
    type ViewModule,
} from './router.ts'
// What a server render puts in <head>. `adopt()`, which is where a compiled `<style>` block lands,
// is on `abide/runtime` — only the emitter writes one.
export { styleTags } from './styles.ts'
// The TYPES of the two transport laws. `remote` and `remoteSocket` themselves are on `abide/runtime`:
// a stub is what the elider writes in place of a handler's body, not a call an app makes. The
// DECLARING half is in `abide/server`, because a handler's body must not ship to a browser.
export type {
    CallOptions,
    Kind,
    Method,
    RemoteOptions,
    RemoteSocket,
    RemoteSocketOptions,
    Rpc,
    RpcHandle,
    Wire,
    // Which app a call is addressed to, which `health()` takes and means the same by.
    WireOptions,
} from './transport.ts'
