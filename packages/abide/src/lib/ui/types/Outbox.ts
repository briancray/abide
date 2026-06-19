/*
A durable, FIFO queue of pending mutations that drains when the client is online —
the local-first half of "act now, sync later". `enqueue` records a serializable
payload (persisted, so it survives a reload) and tries to drain; `pending` is a
reactive read of the payloads still in flight (for a "3 unsynced" indicator);
`flush` drains on demand (and is what the reconnect effect calls); `dispose` stops
draining and detaches persistence.
*/
export type Outbox<T> = {
    enqueue: (payload: T) => void
    pending: () => T[]
    flush: () => Promise<void>
    dispose: () => void
}
