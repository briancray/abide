import { logStream } from './logging.ts'

Bun.serve({
    routes: {
        '/api/logs': (request, server) => {
            if (server.upgrade(request)) return undefined
            return new Response(null, { status: 400 })
        },
    },
    websocket: {
        async open(socket) {
            for await (const line of logStream('api')) {
                socket.send(JSON.stringify(line))
            }
        },
        message() {},
    },
})
