import { database } from './database.ts'

Bun.serve({
    routes: {
        '/api/invoices': async (request) => {
            const year = new URL(request.url).searchParams.get('year')
            return Response.json(await database.invoice.byYear(Number(year)))
        },
    },
})
