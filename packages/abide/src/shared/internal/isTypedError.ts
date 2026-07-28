// Narrow a caught value to a typed error by name — the predicate behind `fn.isError(e, name)`. A typed
// error (`error.typed(name, …)`) carries its name as `kind` (a client-decoded HttpError-like) or `name`
// (a server HttpError, and the platform `DOMException` a deadline aborts with).
//
// Isomorphic by placement, not by coincidence: the server callable and the browser proxy both attach
// `isError`, and while it lived in `server/internal/` the client could not import it and carried a
// verbatim copy of the two-field test instead (ADR 0026 forbids the `ui/ → server/` edge).
export function isTypedError(e: unknown, name: string): boolean {
    if (e === null || typeof e !== 'object') return false
    const record = e as Record<string, unknown>
    return record.kind === name || record.name === name
}
