// The two rules both documents an app can contribute to are built by: what a hook RETURNED, and what
// a hook THREW.
//
// `health()` and `identity()` ask the same question of what the app reported — does it have fields
// at all — and answer it the same way: the app's fields over abide's, INCLUDING the floor, because a
// reporter that knows its own version or its own principal knows something the framework cannot.
// `identity.ts` already said in prose that it merges "the same rule `health()` merges by"; this is
// that rule, spelled once, so a change to it cannot land on one document and not the other.
//
// The logger is an argument rather than an import, so this stays a leaf and each caller warns on its
// own channel — which is what tells an operator which hook returned the thing with no fields.

import { errorPayload, type WireError } from '$shared/internal/wire.ts'

/**
 * A hook that THREW, as the document it means: the floor, with the failure under `error`.
 *
 * The floor arrives already built rather than as a thunk, so the fail-open/fail-closed difference
 * stays legible at the call site — `baseline()` carries the health document's own fields over,
 * `anonymous()` is identity refusing to build a principal out of a failure. That choice is the whole
 * of what separated the two copies of this; everything around it was the same four lines.
 */
export function failedInto<T extends { error?: WireError }>(
    floor: T,
    failure: unknown,
    log: { warning: (message: string) => void },
    hook: string,
    tail = '',
): T {
    // The same reduction every other abide failure gets, so what a reporter threw reads the same as
    // what a handler threw rather than being a second rule for the same job.
    const error = errorPayload(failure).error
    log.warning(`${hook} threw: ${error.name}: ${error.message}${tail}`)
    floor.error = error
    return floor
}

export function merged<T extends object>(
    document: T,
    reported: unknown,
    log: { warning: (message: string) => void },
    what: string,
): T {
    if (reported === null || reported === undefined) return document
    if (typeof reported !== 'object' || Array.isArray(reported)) {
        // Nothing to merge, and silently dropping it would leave an app believing it reported
        // something. A warning rather than a throw: the fields are lost either way, and losing the
        // floor with them helps nobody reading this.
        log.warning(`${what} is a ${typeof reported}, which has no fields to merge`)
        return document
    }
    return Object.assign(document, reported)
}
