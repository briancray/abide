// Public reactive reaction primitive for `.abide` components (M3a).
//
// `watch(thunk)` — auto-tracked effect: re-runs whenever anything it reads changes.
// `watch(source, handler)` — runs `handler(next, previous)` on change (NOT on the initial read), with
// the handler executed untracked so its own reads don't subscribe.
//
// The source is ALWAYS a thunk (ADR 0025). That is what makes the tracked region a plain lexical thing
// you can point at, and it is why several inputs need no API of their own: they are just what the thunk
// returns — `watch(() => ({ a, b }), ({ a, b }) => …)`.
//
// Returns a disposer that tears down the underlying effect.
//
// TEARDOWN: either form may RETURN a cleanup function, and it runs before the next run and again when
// the watch is disposed — which for a `watch` created in a component `<script>` is that component's
// unmount. That return is the whole lifecycle story: there is no `onMount`/`onDestroy`, setup is the
// script body and cleanup is what the watch hands back.

import { effect, untrack } from './internal/reactive.ts'

// biome-ignore lint/suspicious/noConfusingVoidType: mirrors effect()'s param — a run returns nothing or a cleanup fn
type Teardown = void | (() => void)

// The return is INSPECTED, not required: a function becomes the teardown, anything else is discarded.
// That is why both slots type as `unknown` — `watch(count, (n) => seen.push(n))` returns a number and
// stays legal, exactly as in the thunk form.
export function watch<T>(source: () => T, handler?: (next: T, previous: T) => unknown): () => void {
    if (handler === undefined) {
        return effect(source as () => Teardown)
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
        return untrack(() => handler(next, prior)) as Teardown
    })
}
