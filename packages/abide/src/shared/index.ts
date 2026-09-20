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
export { props } from './props.ts'
export { Raw, raw } from './Raw.ts'
export {
    busy,
    type Disposer,
    type Effect,
    // 10.5's pair — not an app's names: an emitted component opens its instance's share scope
    // with them, on both sides, and `importClause` binds them under `__`.
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
