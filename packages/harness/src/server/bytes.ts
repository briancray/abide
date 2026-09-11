// HOW BIG A THING IS. Two arms, one question, and the type decides which: a `Response`,
// a `Blob`, a string or a buffer is measured by its PAYLOAD — the document, the built
// bundle per entry — and anything else by JSC's shallow estimate, which is what
// "bytes retained under a stalled reader" is. "Allocates no queue" is not directly
// observable; the retention is.

import { estimateShallowMemoryUsageOf } from 'bun:jsc'

export async function bytes(of: unknown): Promise<number> {
    // CLONED, because reading a `Response`'s body consumes it: measuring what a route
    // returns and then serving the same object throws "Body already used" at the
    // caller, one line away from the measurement and looking nothing like it.
    if (of instanceof Response)
        return (await of.clone().arrayBuffer()).byteLength
    if (of instanceof Blob) return of.size
    if (typeof of === 'string') return Buffer.byteLength(of)
    if (ArrayBuffer.isView(of)) return of.byteLength
    if (of instanceof ArrayBuffer) return of.byteLength
    return estimateShallowMemoryUsageOf(of as object)
}
