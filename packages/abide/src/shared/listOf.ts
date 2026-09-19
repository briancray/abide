// 32.16, 32.24 — WHAT A `{#for}` SUBJECT ITERATES AS: nothing for an absent subject, an ASYNC
// iterable handed back as itself, and anything else as an array. Named by the async brand AND the
// absence of the sync one, in that order, because `for … of` prefers the sync brand where a value
// carries both. A subject carrying neither fails on the spread. An array is not copied: a
// reconcile reads it synchronously and keeps only its items.
export function listOf(subject: unknown): unknown[] | AsyncIterable<unknown> {
    if (subject == null) return []
    if (Array.isArray(subject)) return subject
    if (
        typeof (subject as AsyncIterable<unknown>)[Symbol.asyncIterator] ===
            'function' &&
        typeof (subject as Iterable<unknown>)[Symbol.iterator] !== 'function'
    )
        return subject as AsyncIterable<unknown>
    return [...(subject as Iterable<unknown>)]
}
