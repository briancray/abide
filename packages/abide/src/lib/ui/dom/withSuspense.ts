import { SuspenseSignal } from '../runtime/SuspenseSignal.ts'

/*
Runs `read`, returning `fallback` when it SUSPENDS — a pending blocking `await` read throws a
`SuspenseSignal` (ADR-0042). The reading region shows `fallback` until the value resolves; the
throwing read subscribed the enclosing effect to the cell, so the effect re-runs and fills in on
settle. Any non-suspense error propagates unchanged (a real rejection still reaches `{#try}`). The
single place the `instanceof SuspenseSignal` swallow lives for a value-returning bind, so the read
sites (`each`, `watch`, …) share one definition rather than copying the try/catch. Text binds use
the sibling `readTextOrSuspend` (fallback `''` with String coercion); an attribute leaves itself
unset inline (a side effect, not a fallback value).
*/
export function withSuspense<T>(read: () => T, fallback: T): T {
    try {
        return read()
    } catch (signal) {
        if (!(signal instanceof SuspenseSignal)) {
            throw signal
        }
        return fallback
    }
}
