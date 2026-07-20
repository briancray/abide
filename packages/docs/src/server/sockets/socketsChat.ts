import { socket } from 'abide/server/socket'

export interface ChatMessage {
    id: string
    text: string
    via: string
}

// The demo chat socket — an isomorphic pub/sub topic. `clientPublish` opens the two client publish
// paths (the HTTP face POST and the WS-mux `pub` frame); `tail` replays the last N messages to every
// new subscriber (so a page reload re-sees recent history); `handler` MEDIATES every *client*
// publish (a server `publish` bypasses it) — here it stamps a fresh id + `via: "client"` and drops
// empty messages by returning `undefined`.
// #demo socket-def
export default socket<ChatMessage>({
    clientPublish: true,
    tail: 20,
    handler: (message) => {
        const text = message && typeof message.text === 'string' ? message.text.trim() : ''
        if (text.length === 0) return
        return { id: crypto.randomUUID(), text, via: 'client' }
    },
})
// #enddemo
