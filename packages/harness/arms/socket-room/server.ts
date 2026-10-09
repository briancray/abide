const GREETING = JSON.stringify({
    speaker: 'support',
    text: 'Ask about any invoice here.',
})
const HOUR = 3_600_000

// A ROOM PER ID: its latest turn, for a tab that connects after it was
// sent, and the timer that lets it go once nobody has posted for an hour.
type Room = { latest: string; idle: Timer }
const rooms = new Map<string, Room>()

function forgetLater(id: string): Timer {
    return setTimeout(() => rooms.delete(id), HOUR).unref()
}

function roomOf(id: string): Room {
    let room = rooms.get(id)
    if (room === undefined) {
        room = { latest: GREETING, idle: forgetLater(id) }
        rooms.set(id, room)
    }
    return room
}

const server = Bun.serve({
    fetch(request, upgrading) {
        const url = new URL(request.url)
        const id = url.searchParams.get('id')
        if (
            url.pathname === '/room' &&
            id &&
            upgrading.upgrade(request, { data: { id } })
        )
            return
        return new Response('', { status: 404 })
    },
    websocket: {
        data: {} as { id: string },
        open(socket) {
            socket.subscribe(socket.data.id)
            socket.send(roomOf(socket.data.id).latest)
        },
        // EVERY TAB IN THE ROOM IS SENT THE TURN, the one that sent it
        // included, so no tab paints a turn the room never took.
        message(socket, text) {
            const turn = JSON.parse(String(text))
            const latest = JSON.stringify({
                speaker: turn.speaker,
                text: turn.text,
            })
            const room = roomOf(socket.data.id)
            room.latest = latest
            clearTimeout(room.idle)
            room.idle = forgetLater(socket.data.id)
            server.publish(socket.data.id, latest)
        },
    },
})
