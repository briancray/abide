import { socket } from 'abide/server/socket'

// A standalone topic owned solely by the peek() demo, for the same reason `socketsPulse` is standalone:
// the demo's whole claim is that `peek()` leaves the topic IDLE, and a topic another demo has already
// subscribed to could not show that. Nothing else on the site touches this one.
// #demo socket-peek
export default socket<{ id: string; text: string }>({
    channel: { tail: 4 },
    clientPublish: true,
})
// #enddemo
