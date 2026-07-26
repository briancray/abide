import { POST } from 'abide/server/POST'
import { notes, roomSequence } from '$shared/roomChannel'

// Publish into ONE room of the shared channel. `publish(args, message)` — `args` IS the room, so this
// message is invisible to a subscriber or reader of any other room.
// #demo channelPost
export default POST(({ room, text }: { room: string; text: string }) => {
    roomSequence.next = roomSequence.next + 1
    notes.publish({ room }, { at: roomSequence.next, text })
    return { room, at: roomSequence.next }
})
// #enddemo
