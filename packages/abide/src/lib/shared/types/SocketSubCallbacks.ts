/* The callback contract a SocketChannel drives per subscription — how the
   channel hands a sub its frames and lifecycle. Shared by every channel
   implementation (the browser multiplex, the test harness) and the Socket<T>
   builder that wires these onto a push iterator. */
export type SocketSubCallbacks = {
    onMessage(message: unknown): void
    /* The sub's batched seed from the retained tail (possibly empty) — the replay/live boundary. */
    onReplay(messages: unknown[]): void
    onError(message: string): void
    onEnd(): void
    /* Transport loss (ws close), as opposed to a per-sub server `err` frame — recoverable. */
    onDisconnect(): void
}
