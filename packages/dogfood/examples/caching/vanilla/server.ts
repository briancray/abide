import { database, fetchRate } from './database.ts'

// The cache lives on the client, so the server has to be told
// separately what may be shared and for how long — the same two
// numbers again, in a third place.
Bun.serve({
    routes: {
        '/api/customer': async (request) => {
            const id = new URL(request.url).searchParams.get('id')
            return Response.json(await database.customer.find(id), {
                headers: { 'cache-control': 'private, no-store' },
            })
        },
        '/api/rate': async (request) => {
            const pair = new URL(request.url).searchParams.get('pair')
            return Response.json(await fetchRate(pair), {
                headers: { 'cache-control': 'public, max-age=60' },
            })
        },
    },
})
