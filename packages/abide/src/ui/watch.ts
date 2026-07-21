// Public reactive reaction primitive for `.abide` components (M3a).
//
// `watch(thunk)` — auto-tracked effect: re-runs whenever anything it reads changes.
// `watch(source, handler)` — runs `handler(next, previous)` on change (NOT on the initial read), with
// the handler executed untracked so its own reads don't subscribe.
//
// Returns a disposer that tears down the underlying effect.

import { effect, untrack } from '../shared/internal/reactive.ts'

export function watch<T>(source: () => T, handler?: (next: T, previous: T) => void): () => void {
    if (handler === undefined) {
        // biome-ignore lint/suspicious/noConfusingVoidType: mirrors effect()'s param — the thunk returns nothing or a cleanup fn
        return effect(source as () => void | (() => void))
    }
    let first = true
    let previous: T
    return effect(() => {
        const next = source()
        if (first) {
            first = false
            previous = next
            return
        }
        const prior = previous
        previous = next
        untrack(() => handler(next, prior))
    })
}
