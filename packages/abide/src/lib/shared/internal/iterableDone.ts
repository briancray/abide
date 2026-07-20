// Completion tracking for async iterables consumed by `{#for await}` — the substrate behind the
// public `done()` probe. Each tracked iterable gets a reactive boolean signal that flips true when the
// runtime finishes draining it (normal end or a thrown error). Keyed in a WeakMap by the iterable's
// identity, so the SAME object must be handed to both `{#for await …}` and `done(…)` — create the
// stream once (a `<script>` const / `state`) and reuse it.

import { type Signal, signal } from './reactive.ts'

const DONE_SIGNALS = new WeakMap<object, Signal<boolean>>()

function isTrackable(iterable: unknown): iterable is object {
    return iterable !== null && (typeof iterable === 'object' || typeof iterable === 'function')
}

function slotFor(iterable: object): Signal<boolean> {
    let existing = DONE_SIGNALS.get(iterable)
    if (existing === undefined) {
        existing = signal(false)
        DONE_SIGNALS.set(iterable, existing)
    }
    return existing
}

// Reactive read: true once the iterable has finished streaming. Tracks in the current effect, so a
// template `{done(stream)}` / `{#if done(stream)}` re-renders when the stream completes. A
// non-object (or one never streamed) reads false.
export function iterableDone(iterable: unknown): boolean {
    if (!isTrackable(iterable)) return false
    return slotFor(iterable)()
}

// Runtime hook: a `{#for await}` source was fully drained (or errored) — flip the signal.
export function markIterableDone(iterable: unknown): void {
    if (!isTrackable(iterable)) return
    slotFor(iterable).set(true)
}
