import { database } from './database.ts'

Bun.serve({
    routes: {
        '/api/search': async (request) => {
            const url = new URL(request.url)
            const q = url.searchParams.get('q') ?? ''
            return Response.json(await database.invoice.search(q))
        },
    },
})
