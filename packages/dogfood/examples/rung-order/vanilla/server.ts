const INVOICES = ['INV-4310', 'INV-4311', 'INV-4312']

const LIMIT = 3

Bun.serve({
    routes: {
        '/api/searchInvoices': (request) => {
            // THE RUNG, AND THE ORDER IT RUNS IN. The parse below it is
            // the whole of what this ordering buys: hoisted above the
            // check, a signed-out caller reads the schema back out of a
            // 422 that should have been a 401.
            if (!request.headers.get('authorization')) {
                return Response.json(
                    {
                        name: 'HttpError',
                        status: 401,
                        message: 'Sign in first.',
                    },
                    { status: 401 },
                )
            }
            const { searchParams } = new URL(request.url)
            const limit = Number(searchParams.get('limit') ?? '20')
            if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT) {
                return Response.json(
                    {
                        name: 'ValidationError',
                        status: 422,
                        message: 'Those arguments were refused.',
                        data: { limit: ['Between 1 and 3.'] },
                    },
                    { status: 422 },
                )
            }
            return Response.json(INVOICES.slice(0, limit))
        },
    },
})
