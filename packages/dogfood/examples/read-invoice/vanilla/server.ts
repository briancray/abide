import { database } from './database.ts'

Bun.serve({
    routes: {
        '/api/invoice': async (request) => {
            const id = new URL(request.url).searchParams.get('id') ?? ''
            const invoice = await database.invoice.find(id)
            if (!invoice) return new Response('Not found', { status: 404 })
            return Response.json(invoice)
        },
    },
})
