// The pool `app.ts` opens before the first request and closes after the last.

/** A pool that takes a moment to connect, as a real one does. */
export const startHookDatabase = {
    connected: false,
    connectedAt: '',
    upAt: '',
    async connect(): Promise<void> {
        await Bun.sleep(300)
        this.connected = true
        this.connectedAt = new Date().toISOString()
    },
    async close(): Promise<void> {
        this.connected = false
    },
}
