const LATEST = [
    { page: '/pricing', at: '09:41:02' },
    { page: '/signup', at: '09:41:05' },
    { page: '/docs', at: '09:41:09' },
]

function after(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

Bun.serve({
    routes: {
        // THE FRAMING, BY HAND: `data: ` and the blank line after each event,
        // and the two headers that keep a proxy from holding the stream back.
        '/api/visits': () => {
            const encoder = new TextEncoder()
            let at = 0
            return new Response(
                new ReadableStream({
                    async pull(controller) {
                        if (at === LATEST.length) return controller.close()
                        await after(300)
                        const visit = JSON.stringify(LATEST[at])
                        controller.enqueue(encoder.encode(`data: ${visit}\n\n`))
                        at += 1
                    },
                }),
                {
                    headers: {
                        'content-type': 'text/event-stream',
                        'cache-control': 'no-cache',
                        'x-accel-buffering': 'no',
                    },
                },
            )
        },
    },
})
