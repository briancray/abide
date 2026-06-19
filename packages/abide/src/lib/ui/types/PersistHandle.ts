/*
The handle returned by `persist(doc, key)`. `flush` writes the pending snapshot
immediately (the debounced writer otherwise coalesces a burst); `clear` removes
the stored snapshot; `dispose` stops persisting (unsubscribes, drops listeners).
On the server or a store-less browser, every method is a no-op.
*/
export type PersistHandle = {
    flush: () => void
    clear: () => void
    dispose: () => void
}
