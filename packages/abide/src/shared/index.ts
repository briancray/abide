// The isomorphic authoring surface — what an app reaches through `@abide/abide`.
// Same callable, same name, same intent on both sides: the reactive value and the
// types its probes narrow to live here, and nothing in this seam may import #ui or
// #server.
//
// ONE FACTORY. `state`, `memo` and `channel` are gone — `reactive` carries all three through its
// overloads, a channel being a value whose array every caller appends to.
//
// ONE REFUSAL TYPE beside it. `Failed` is the only thing a producer answers in place of a
// value (15.1), so it is in this seam rather than the server's: the same object crosses a
// wire, fills `s.error` and narrows through `s.isError`.
//
// EVERY NAME HERE HAS A REGISTRY ROW. What only compiled `.abide` output calls — the escaping, the
// prop cells, the share scope — is on the two entries the compiler emits imports from,
// `@abide/abide/runtime` and `@abide/abide/server/runtime`, and `coverage.test.ts` holds this
// barrel to the registry so it cannot regrow there.

// 44 — a conversation as a page sends it and is handed it back: the server's `assistant` yields it.
export type {
    AssistantContent,
    AssistantEvent,
    AssistantMessage,
} from './AssistantEvent.ts'
// 33.23 — an element's attributes, typed as a component's props.
export type { Attributes } from './Attributes.ts'
export { type Cookies, cookies } from './cookies.ts'
export { csp } from './csp.ts'
// 38.141 — which native window the work running is for.
export { native } from './native.ts'
// 38.148 — the update the native app's window has staged.
export { pendingUpdate, type StagedUpdate } from './pendingUpdate.ts'
export { type Failed, isFailed } from './Failed.ts'
// 25 — the account of the app.
export { type Health, health } from './health.ts'
// 44.52-44.55 — a pasted, dropped or picked image as a turn's piece.
export { imageFiles, imagePiece } from './imagePiece.ts'
export type { Issues, Paths } from './Issues.ts'
export type { JsonValue } from './JsonValue.ts'
export { isServer } from './isServer.ts'
export { jsonSchema } from './jsonSchema.ts'
export { type Logger, type LogRecord, log } from './log.ts'
export type { Middleware } from './Middleware.ts'
export type { Params } from './matchRoute.ts'
// 38.88 — a native app's menu items, and the hook a route's layouts and page file them with.
export {
    type MenuEntry,
    type MenuItem,
    type MenuRole,
    menuItem,
} from './menuItem.ts'
// `navigate` ALONE, of everything routing needs. This barrel is what an app resolves through the
// bare `@abide/abide` specifier, and the matcher, the pattern grammar and `routeOf` are reached by path
// from the two places that have them — the build and the client router. Putting them here would
// widen the public surface with names no clause or registry row gives an author, and drag both
// modules into the static closure of the entry every page imports.
export { media } from './media.ts'
export { navigate } from './navigate.ts'
// 32.79-32.92 — the measuring adaptors a `bind:element` takes.
export * as observe from './observe/index.ts'
export { online } from './online.ts'
export { outbox, type QueuedCall } from './outbox.ts'
// 37.16 — the browser's `onError`. `@abide/abide/server` exports the server's over it.
export { onError } from './onError.ts'
export { onMenu } from './onMenu.ts'
// 44.69 — this browser's pairing with a Claude Code bridge, and the click that pairs one.
export { pairing } from './pairing.ts'
// 37.22 — the browser's `onRefusal`, which has no server's.
export { onRefusal } from './onRefusal.ts'
export { type Principal, principal } from './principal.ts'
export { props } from './props.ts'
export { Raw, raw } from './Raw.ts'
export {
    busy,
    type Disposer,
    type Effect,
    flushSync,
    type Identity,
    invalidate,
    isReactive,
    type Keyed,
    NotLanded,
    type Reactive,
    type ReactiveOptions,
    reactive,
    ready,
    refresh,
    type Selection,
    type Shared,
    stopSignal,
    type Store,
    structural,
    synced,
    type Transformer,
    watch,
} from './reactive/index.ts'
export { refuse } from './refuse.ts'
// 44.51 — what a conversation's calls to one handler answered.
export { resultsOf } from './resultsOf.ts'
export { route } from './route.ts'
export type { Schema, StandardSchemaV1 } from './Schema.ts'
// 8.22, 8.34, 8.37 — the `Store`s, as one namespace: `store.web`, `store.indexedDB`, `store.cookies`.
// `@abide/abide/server` exports its own over this one, with the two a server alone has.
export * as store from './stores.ts'
// 30.1 — the address builder, and the types that read a route literal for it.
export {
    type HasParams,
    type HasSegments,
    type OptionalNames,
    type ParamsOf,
    type Query,
    type RequiredNames,
    type RestNames,
    type RouteLiteral,
    type RouteParams,
    type Routes,
    url,
} from './url.ts'
export { validateJson } from './validateJson.ts'
