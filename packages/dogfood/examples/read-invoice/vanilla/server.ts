import { database } from './database.ts'

Bun.serve({
    routes: {
        '/api/invoices/:id': async (request) => {
            const invoice = await database.invoice.find(request.params.id)
            if (!invoice) return new Response('Not found', { status: 404 })
            return Response.json(invoice)
        },
    },
})
