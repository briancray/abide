import { logStream } from './logging.ts'

Bun.serve({
    routes: {
        '/api/logs': (request) => {
            const stream = new URL(request.url).searchParams.get('stream') ?? 'api'
            // One line per chunk, so the client can fold each as it lands
            // rather than waiting for a body that never ends. The retention
            // is the client's problem here: there is no tail on this side to
            // hand it, which is the two functions the bench below counts.
            const body = new ReadableStream({
                async start(controller) {
                    const encoder = new TextEncoder()
                    for await (const line of logStream(stream)) {
                        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`))
                    }
                    controller.close()
                },
            })
            return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } })
        },
    },
})
