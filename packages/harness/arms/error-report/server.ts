// THE REPORT, BY HAND: a try around every route, each one remembering to
// tell the tracker and to say nothing about the error to the caller.
const captured: string[] = []

function reported(route: () => Promise<Response>): () => Promise<Response> {
    return async () => {
        try {
            return await route()
        } catch (error) {
            captured.unshift(error instanceof Error ? error.message : '')
            return new Response(null, {
                status: 500,
                statusText: 'Internal Server Error',
            })
        }
    }
}

Bun.serve({
    routes: {
        '/api/exportContacts': reported(async () => {
            await Bun.sleep(300)
            throw new Error('the export worker reset the connection')
        }),
        '/api/capturedErrors': () => Response.json(captured.slice(0, 3)),
    },
})
