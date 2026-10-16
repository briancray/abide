// THE BOOT ORDER, BY HAND: the pool connects, then the server binds,
// then the app notes it is up. Moving `Bun.serve` above the connect is
// one line, and the first request then races a pool that is not there.
const pool = { connectedAt: '', upAt: '' }

await Bun.sleep(300)
pool.connectedAt = new Date().toISOString()

Bun.serve({
    routes: {
        '/api/pool': () => Response.json(pool),
    },
})

pool.upAt = new Date().toISOString()
