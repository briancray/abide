// 12.2 — an `Effect` runs immediately when its `watch` is registered. 12.11 owes it a
// rerun when a value it read changes and 12.12 has the reruns owed within one microtask
// delivered as one, which is `graph.ts`'s scheduled drain rather than anything here.
// Everything else in this file is the two narrowings and the three failure clauses.

import { warn } from '../warn.ts'
import type { Disposer, Reactive } from './face.ts'
import { detach, EFFECT, onEffectFailure, Reader, untracked } from './graph.ts'

// biome-ignore lint/suspicious/noConfusingVoidType: REGISTRY's `Effect` row, and the registry is what an app is typed against.
export type Effect = () => void | Disposer

// 12.7 — a throw from an `Effect` or a `Disposer`, and a read of a failed `Reactive`
// inside one, reaches `onError` with the trace attached and warns on `abide:watch`.
// `onError` is group 37's and has not landed; the warning and 12.9's stop are what is
// here, and the hook is one call site when it does.
onEffectFailure((_reader, thrown) => {
    warn('abide:watch', 'a watch effect or its disposer threw', thrown)
    // 12.8 — in a browser, additionally re-thrown as an unhandled rejection. The
    // probe is on the MEMBER rather than on `typeof Bun`: an example frame defines a
    // `Bun` shim, and a `typeof` test reads that as bun.
    const underBun =
        typeof (globalThis as { Bun?: { nanoseconds?: unknown } }).Bun
            ?.nanoseconds === 'function'
    if (!underBun && typeof window !== 'undefined') Promise.reject(thrown)
})

export function watch(effect: Effect): () => void
export function watch<Stored>(
    sources: Reactive<Stored> | Reactive<Stored>[],
    effect: Effect,
): () => void
export function watch(
    first: Effect | Reactive<unknown> | Reactive<unknown>[],
    second?: Effect,
): () => void {
    let body: () => unknown
    if (second === undefined) body = first as Effect
    else {
        const sources = Array.isArray(first)
            ? (first as Reactive<unknown>[])
            : [first as Reactive<unknown>]
        // 12.4 and 14.6 — the effect runs only when THESE change, so the sources are
        // read tracked and the effect itself is not.
        body = () => {
            for (let at = 0; at < sources.length; at += 1)
                (sources[at] as Reactive<unknown>)()
            return untracked(second)
        }
    }
    const reader = new Reader(EFFECT, undefined, body)
    reader.evaluate()
    return () => {
        if (reader.stopped) return
        reader.stopped = true
        const dispose = reader.disposer
        reader.disposer = undefined
        detach(reader)
        // 12.1 — the `Disposer` runs before each rerun, and ONCE MORE at teardown.
        if (dispose !== undefined) untracked(dispose)
    }
}
