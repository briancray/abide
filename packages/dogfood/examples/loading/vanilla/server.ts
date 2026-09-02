import { database } from './database.ts'

Bun.serve({
    routes: {
        '/api/invoices/:id': async (request) => {
            const invoice = await database.invoice.find(request.params.id)
            if (!invoice) {
                return Response.json(
                    { name: 'HttpError', status: 404, message: 'No such invoice.' },
                    { status: 404 },
                )
            }
            return Response.json(invoice)
        },
    },
})
