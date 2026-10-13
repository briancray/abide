/** The pool `onStart` opens and `onStop` closes. */
export const pool = {
    connected: false,
    async connect(): Promise<void> {
        pool.connected = true
    },
    async close(): Promise<void> {
        pool.connected = false
    },
}
