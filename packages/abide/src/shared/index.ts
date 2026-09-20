// The isomorphic authoring surface — what an app reaches through `abide`.
// Same callable, same name, same intent on both sides: the reactive value and the
// types its probes narrow to live here, and nothing in this seam may import #ui or
// #server.
//
// ONE FACTORY. `state`, `memo` and `channel` are gone — `reactive` carries all three through its
// overloads, a channel being a value that declares `history`.
//
// ONE REFUSAL TYPE beside it. `Failed` is the only thing a producer answers in place of a
// value (15.1), so it is in this seam rather than the server's: the same object crosses a
// wire, fills `s.error` and narrows through `s.isError`.

export {
    escapeAttribute,
    escapeStyleValue,
    escapeText,
} from './escapeText.ts'
export { type Failed, isFailed } from './Failed.ts'
export type { Issues, Paths } from './Issues.ts'
export type { JsonValue } from './JsonValue.ts'
export { jsonSchema } from './jsonSchema.ts'
// 32.16's run-time half. In this seam because BOTH sides ask it what a `{#for}` subject iterates
// as — the server's emitted block, the client's `updateList`, and the markup a client builds for a
// row — so the one function is the one answer.
export { listOf } from './listOf.ts'
// `navigate` ALONE, of everything routing needs. This barrel is what an app resolves through the
// bare `abide` specifier, and the matcher, the pattern grammar and `routeOf` are reached by path
// from the two places that have them — the build and the client router. Putting them here would
// widen the public surface with names no clause or registry row gives an author, and drag both
// modules into the static closure of the entry every page imports.
export { navigate } from './navigate.ts'
export { props } from './props.ts'
export { Raw, raw } from './Raw.ts'
export {
    busy,
    // 10.5's pair — not an app's names: an emitted component opens its instance's share scope
    // with them, on both sides, and `importClause` binds them under `__`.
    currentShare,
    type Disposer,
    type Effect,
    enterShare,
    flushSync,
    type History,
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
    type Transformer,
    watch,
} from './reactive/index.ts'
export { notFound, refuse, validationError } from './refuse.ts'
export type { Schema, StandardSchemaV1 } from './Schema.ts'
export { safeUrl } from './safeUrl.ts'
export { validateJson } from './validateJson.ts'
export { writePath } from './writePath.ts'
