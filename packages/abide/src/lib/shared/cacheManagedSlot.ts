/*
Set while cache() synchronously invokes the underlying remote/producer, so the
client's currentAbortSignal skips scope-binding for cache-managed calls. The cache
coalesces one in-flight request across every reader and owns its lifetime (it
evicts the entry when the request rejects), so a single reader navigating away must
not abort a flight the others still depend on. A plain boolean — cache invokes the
underlying call synchronously and never re-enters across an await. Harmless on the
server, where there is no reactive observer to bind anyway.
*/
export const cacheManagedSlot: { active: boolean } = { active: false }
