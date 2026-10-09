// THE STAMP, WRAPPED BY HAND around each route. A route added without
// `stamped` answers with no header, and nothing says so.
const INSTANCE = crypto.randomUUID().slice(0, 8)

function stamped(
    route: (request: Request) => Response | Promise<Response>,
): (request: Request) => Promise<Response> {
    return async (request) => {
        const answer = await route(request)
        answer.headers.set('x-served-by', INSTANCE)
        return answer
    }
}

Bun.serve({
    routes: {
        '/api/ping': stamped(() => Response.json('pong')),
    },
})
