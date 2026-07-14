/*
The client-installed reactive-reader lifecycle hook stored in cacheReaderSocketSlot
(ADR-0043). The cache store calls engage(key) when a key gains its first live reader
and disengage(key) when it loses its last, so the client can open/close a per-key
amend value subscription whose lifetime tracks "a reader is holding this key on
screen". Inert (slot unresolved) on the server and in isolated unit tests.
*/
export interface CacheReaderHook {
    engage(key: string): void
    disengage(key: string): void
}
