/*
Guarded method call on a reactive-document read. The doc-access lowering rewrites
`model.draft.trim()` into `model.read("draft").trim()`; when that read is nullish
the bare form throws the engine's opaque `undefined is not an object (evaluating
'…read("draft").trim()')`, naming only the desugared call. This wraps the
non-optional call so the throw names the authored scope path and member instead —
the source-mapped stack frame still resolves to the `.abide` line, so message and
location together read in authored terms. Both opaque engine errors are covered: a
nullish receiver (`undefined is not an object`) AND a present receiver whose member
is not callable (`… is not a function`, the misspelled/missing-method case).
Optional-chained calls are left bare: `?.` means skip-if-absent, not throw, so
guarding them would change semantics. `.apply(target, …)` preserves the receiver, so
the method sees the same `this` the bare `target.member(…)` would.
*/
// @documentation plumbing
export function readCall(target: unknown, path: string, member: string, args: unknown[]): unknown {
    if (target === undefined || target === null) {
        throw new TypeError(`abide: cannot call .${member}() — scope value "${path}" is ${target}`)
    }
    const method = (target as Record<string, unknown>)[member]
    if (typeof method !== 'function') {
        throw new TypeError(
            `abide: cannot call .${member}() — "${path}".${member} is not a function (got ${typeof method})`,
        )
    }
    return (method as (...args: unknown[]) => unknown).apply(target, args)
}
