// The isomorphic authoring surface — what an app reaches through `abide`.
// Same callable, same name, same intent on both sides: the reactive values
// (state, memo, channel) and the types their probes narrow to live here, and
// nothing in this seam may import #ui or #server.
//
// EVERY NAME HERE IS A NAME REGISTRY CARRIES, and that is the rule this barrel is
// held to rather than "whatever the seam happens to export". An export in the
// `exports` map is public surface an app can write, and REGISTRY's own format rule 1
// is that a row is a name that appears in application source — so a name exported
// here and absent there is either a missing row or a name that should not be
// reachable. `untracked`, `flushEffects`, `validate`, `comparator` and the three
// guards are none of them REGISTRY rows: the other seams take them from
// `#shared/guards.ts` and `#shared/reactive/*`, which is an import edge rather than a
// surface.

export { structural } from './reactive/comparator.ts'
export type { Disposer, Reactive, Tail } from './reactive/face.ts'
export { memo } from './reactive/memo.ts'
export type { Failed, Issues } from './reactive/refusals.ts'
export { refuse, validationError } from './reactive/refusals.ts'
export {
    type ReactiveOptions,
    type Store,
    state,
    type Transformer,
} from './reactive/state.ts'
export type {
    JsonSchema,
    JsonValue,
    Schema,
    StandardSchemaV1,
} from './reactive/validate.ts'
export { type Effect, watch } from './reactive/watch.ts'
