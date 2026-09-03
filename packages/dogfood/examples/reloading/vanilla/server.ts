import { database } from './database.ts'

const HELD = new Map<string, { at: number; value: unknown }>()
const TTL = 30_000

Bun.serve({
    routes: {
        '/api/stock/:warehouse/:sku': async (request) => {
            const { warehouse, sku } = request.params
            const key = `${warehouse}/${sku}`

            // The `ttl` by hand: an entry past it is dropped on the
            // read that follows, so the sweep is here rather than
            // on a timer nobody asked for.
            if (request.method === 'POST') {
                await database.stock.decrement(warehouse, sku)
                HELD.delete(key)
                const written = await database.stock.find(warehouse, sku)
                return Response.json(written)
            }

            const entry = HELD.get(key)
            if (entry && Date.now() - entry.at < TTL) {
                return Response.json(entry.value)
            }
            const value = await database.stock.find(warehouse, sku)
            HELD.set(key, { at: Date.now(), value })
            return Response.json(value)
        },
    },
})
