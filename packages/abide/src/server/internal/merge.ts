// The one merge both documents an app can contribute to are built by.
//
// `health()` and `identity()` ask the same question of what the app reported — does it have fields
// at all — and answer it the same way: the app's fields over abide's, INCLUDING the floor, because a
// reporter that knows its own version or its own principal knows something the framework cannot.
// `identity.ts` already said in prose that it merges "the same rule `health()` merges by"; this is
// that rule, spelled once, so a change to it cannot land on one document and not the other.
//
// The logger is an argument rather than an import, so this stays a leaf and each caller warns on its
// own channel — which is what tells an operator which hook returned the thing with no fields.

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
