/*
Optional application hooks. Every export is optional; delete the ones you
don't need. Belte resolves this file at build time via the belte:app virtual
module — no import is needed from your own code.

  init        runs once after Bun.serve is up; return a cleanup for SIGINT/SIGTERM
  handle      middleware wrapping the default request pipeline
  handleError custom 500 fallback
  socket      WebSocket handler exposed at /__belte/socket
*/
import type { AppModule } from 'belte/types/AppModule'

/*
Augment SocketData to type ws.data across your app. Remove the augmentation
if you aren't using sockets.
*/
declare module 'belte/types/App' {
    interface SocketData {
        id: number
    }
}

export const init: AppModule['init'] = ({ server }) => {
    console.log(`server listening on http://localhost:${server.port}`)
}

export const handle: AppModule['handle'] = async (request, next) => {
    return next(request)
}

export const handleError: AppModule['handleError'] = (error) => {
    console.error(error)
    return new Response('something went wrong', { status: 500 })
}

let nextId = 0

export const socket: AppModule['socket'] = {
    upgrade: () => ({ data: { id: ++nextId } }),
    open(ws) {
        ws.send(`hi #${ws.data.id}`)
    },
    message(ws, message) {
        ws.send(`echo: ${message}`)
    },
}
