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

// 44 — a conversation as a page sends it and is handed it back: the server's `assistant` yields it.
export type {
    AssistantContent,
    AssistantEvent,
    AssistantMessage,
} from './AssistantEvent.ts'
// 33.23 — an element's attributes, typed as a component's props.
export type { Attributes } from './Attributes.ts'
// 32.37 — what a value writes into an attribute, on both sides.
export { attributeMarkup, attributeText } from './attributeText.ts'
// EMITTED CODE'S: the value a `bind:` operand holds, as the server writes it into the tag (32.5).
export {
    boundProp,
    boundValue,
    groupHolds,
    selectedMarkup,
} from './boundValue.ts'
export { type Cookies, cookies } from './cookies.ts'
export { csp } from './csp.ts'
export { escapeAttribute, escapeStyleValue, escapeText } from './escapeText.ts'
export { type Failed, isFailed } from './Failed.ts'
// 25 — the account of the app.
export { type Health, health } from './health.ts'
// 44.52-44.55 — a pasted, dropped or picked image as a turn's piece.
export { imageFiles, imagePiece } from './imagePiece.ts'
export type { Issues, Paths } from './Issues.ts'
export type { JsonValue } from './JsonValue.ts'
export { isServer } from './isServer.ts'
export { jsonSchema } from './jsonSchema.ts'
// 32.15's run-time half. In this seam because BOTH sides ask it what a `{#for}` subject iterates
// as — the server's emitted block, the client's `updateList`, and the markup a client builds for a
// row — so the one function is the one answer.
export { listOf } from './listOf.ts'
export { type Logger, type LogRecord, log } from './log.ts'
export type { Middleware } from './Middleware.ts'
export type { Params } from './matchRoute.ts'
// 38.88 — a desktop app's menu items, and the hook a route's layouts and page file them with.
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
export { navigate } from './navigate.ts'
export { online } from './online.ts'
export { outbox, type QueuedCall } from './outbox.ts'
// 37.16 — the browser's `onError`. `@abide/abide/server` exports the server's over it.
export { onError } from './onError.ts'
export { onMenu } from './onMenu.ts'
// 37.22 — the browser's `onRefusal`, which has no server's.
export { onRefusal } from './onRefusal.ts'
export { type Principal, principal } from './principal.ts'
// EMITTED CODE'S: a prop the child writes (33.6, 33.7), and one it hands where a `Reactive` is due (33.27).
export {
    heldProp,
    propCell,
    propCells,
    propOr,
    restValues,
    withoutKeys,
} from './propCell.ts'
export { props } from './props.ts'
// `markupRun` and `RAW_WRITES` are EMITTED CODE'S: a text run anchored while it holds markup (32.30).
export { markupRun, RAW_WRITES, Raw, raw } from './Raw.ts'
export {
    busy,
    // 10.5's pair — not an app's names: an emitted component opens its instance's share scope
    // with them, on both sides, and `importClause` binds them under `__`.
    currentShare,
    type Disposer,
    type Effect,
    enterShare,
    flushSync,
    type Identity,
    invalidate,
    isReactive,
    type Keyed,
    leaveShare,
    NotLanded,
    type Reactive,
    type ReactiveOptions,
    reactive,
    ready,
    refresh,
    resumeShare,
    type Selection,
    type Shared,
    type Store,
    structural,
    synced,
    type Transformer,
    watch,
} from './reactive/index.ts'
export { aborted, notFound, refuse, validationError } from './refuse.ts'
// 44.51 — what a conversation's calls to one handler answered.
export { resultsOf } from './resultsOf.ts'
export { route } from './route.ts'
export type { Schema, StandardSchemaV1 } from './Schema.ts'
export { safeUrl } from './safeUrl.ts'
// EMITTED CODE'S, not an author's — no REGISTRY row, the way `escapeText` and `listOf` have
// none. A markup position that aborts on an unlanded read (32.23) is the compiler's business.
export { slotValue } from './slotValue.ts'
// EMITTED CODE'S — 34.32's naming of a setup's read of an unlanded value.
export { setupThrown } from './setupThrown.ts'
// EMITTED CODE'S — 32.11's spread, as props and as markup.
export { spreadAttributes, spreadProps } from './spread.ts'
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
// 8.22 — a `Store` in the browser's Web Storage, inert where there is none (8.23).
export { webStore } from './webStore.ts'
export { mutatePath, writePath } from './writePath.ts'
