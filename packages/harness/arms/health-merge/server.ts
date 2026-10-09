// THE ACCOUNT, MERGED BY HAND: the baseline every app reports, with the
// app's own fields spread over it so the app wins a collision.
const STARTED_AT = new Date().toISOString()
const database = { connected: true }

Bun.serve({
    routes: {
        '/health': () =>
            Response.json(
                {
                    version: '0.0.0',
                    abide: '0.0.0',
                    startedAt: STARTED_AT,
                    database: database.connected ? 'connected' : 'closed',
                },
                { headers: { 'cache-control': 'no-store' } },
            ),
    },
})
