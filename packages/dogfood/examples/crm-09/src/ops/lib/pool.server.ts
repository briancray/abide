/** The CRM's database pool: slow to connect, as a real one is. */
export const pool = {
    connected: false,
    connectedAt: '',
    upAt: '',
    async connect(): Promise<void> {
        await Bun.sleep(300)
        pool.connected = true
        pool.connectedAt = new Date().toISOString()
    },
}
