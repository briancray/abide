import type { ShadowKind } from './ShadowKind.ts'

/*
The typed branch-local shadow stack both lowering back-ends thread through. Replaces
the two loose `Set`s reached via closure with one value owning both kinds, and the
manual push-then-pop with a single structured `withShadow` that pushes on entry and
pops in a `finally` — so a branch's shadows cannot outlive the branch even if the body
throws (the SSR `await then` TDZ path threw mid-body and leaked under the old hand pop).

`names` snapshots a kind for the expression transformer: a binding pushed mid-compile
must be honoured AND shadow a same-named component signal.
*/
export type ShadowScope = {
    /* Push the names not already present (under `kind`) for the duration of `body`, then
       pop exactly what was added — in a `finally`, so a throw cannot leak the shadow. */
    withShadow: <T>(names: Iterable<string>, kind: ShadowKind, body: () => T) => T
    /* A snapshot of the names currently shadowing under `kind`, for the transformer. */
    names: (kind: ShadowKind) => ReadonlySet<string>
}
