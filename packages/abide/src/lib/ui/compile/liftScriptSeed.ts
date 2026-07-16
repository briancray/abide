import { liftAsyncSubExpressions } from './liftAsyncSubExpressions.ts'
import type { InjectedCell } from './lowerAsyncInterpolations.ts'
import type { InterpolationClassifier } from './types/InterpolationClassifier.ts'

/* The pieces a script-seed lift yields: the async sub-expressions hoisted out of a
   `state`/`linked`/`computed` seed argument (each an injected peek-cell) plus the seed
   rewritten to reference them by bare `__vsN`. `desugarSignals` turns `cells` into
   `scope().trackedComputed(...)` consts emitted BEFORE the owning declaration and parses
   `rewrittenSeedText` back into the lowered seed. */
export type ScriptSeedLift = { cells: InjectedCell[]; rewrittenSeedText: string }

/*
The script-side twin of the template `lowerAsyncInterpolations` walk (ADR-0032): runs
`liftAsyncSubExpressions` over a `state`/`state.linked`/`state.computed` seed ARGUMENT so a
buried promise/stream sub-expression (`getSession()?.filteredSources ?? []`) lifts to an
injected streaming peek-cell — reading `undefined` while pending so `?.`/`??` compose — exactly
as it would in a `{#if getSession()?.x}` template position. Only PROPER sub-expressions lift: a
seed that IS a single async expression (`computed(getSession())`, `linked(getStream())`) is left
whole for the existing whole-seed classification / runtime probe, so this never double-wraps.

`classify` absent (no warm program) ⇒ no lift — a buried bare-async sub-expression needs the
checker to know it is a promise, and a seed carrying a top-level `await` is already routed by the
caller's whole-seed classification, so fail-open here is a plain no-op. `seedLoc` is the seed's
absolute source offset, so each lifted span resolves against the shadow's source→shadow mappings.
*/
export function liftScriptSeed(
    seedText: string,
    seedLoc: number,
    classify: InterpolationClassifier | undefined,
    mint: () => string,
): ScriptSeedLift | undefined {
    if (classify === undefined) {
        return undefined
    }
    const result = liftAsyncSubExpressions(seedText, seedLoc, classify, mint, 'content')
    if (result.lifts.length === 0) {
        return undefined
    }
    /* A single span covering the whole seed is the whole-seed case (`computed(getSession())`) —
       leave it to the existing classification (`isPromiseComputed`) / the runtime probe rather
       than pointlessly wrapping the seed in its own cell. Only proper sub-expressions lift. */
    const only = result.spans.length === 1 ? result.spans[0] : undefined
    if (only !== undefined && seedText.slice(only.start, only.end).trim() === seedText.trim()) {
        return undefined
    }
    return { cells: result.lifts, rewrittenSeedText: result.code }
}
