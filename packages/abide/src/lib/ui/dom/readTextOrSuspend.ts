import { SuspenseSignal } from '../runtime/SuspenseSignal.ts'

/*
The text a reactive `{expr}` binding writes: the stringified value, or `''` while a blocking
`await` read is pending — a `SuspenseSignal` (ADR-0042). Nullish stringifies to `''` (never the
literal `"undefined"`), so a pending streaming read and a suspended blocking read both show nothing.
A suspending read still tracked its cell before throwing, so the enclosing bind effect re-runs and
fills in once the value resolves. Rethrows any non-suspense error unchanged.
*/
export function readTextOrSuspend(read: () => unknown): string {
    let next: unknown
    try {
        next = read()
    } catch (signal) {
        if (!(signal instanceof SuspenseSignal)) {
            throw signal
        }
        return ''
    }
    return next == null ? '' : String(next)
}
