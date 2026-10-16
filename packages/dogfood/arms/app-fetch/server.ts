// THE APP, HELD BY HAND: a test has to bind a port to reach it, and the
// header a test asserts on is one more line every route has to write.
const pool = { connected: true }

function traceparent(): string {
    const id = crypto.randomUUID().replaceAll('-', '')
    const span = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
    return `00-${id}-${span}-00`
}

Bun.serve({
    routes: {
        '/api/pool': () =>
            Response.json(pool, {
                headers: { traceresponse: traceparent() },
            }),
    },
})
