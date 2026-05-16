import type { SocketUpgrade } from 'belte/server'
import type { ServerWebSocket, WebSocketHandler } from 'bun'

type Data = { id: number }

let nextId = 0

export const path = '/ws'

export const upgrade: SocketUpgrade<Data> = () => ({
    data: { id: ++nextId },
})

export const socket: WebSocketHandler<Data> = {
    open(ws: ServerWebSocket<Data>) {
        ws.send(`hi #${ws.data.id}`)
    },
    message(ws: ServerWebSocket<Data>, msg) {
        ws.send(`echo: ${msg}`)
    },
}
