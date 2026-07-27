import { socket } from 'abide/server/socket'

export interface ChatMessage {
    id: string
    text: string
    via: string
}

// The demo chat socket — an isomorphic pub/sub topic. `tail` replays the last N messages to every new
// subscriber (so a page reload re-sees recent history); the `clientPublish` FUNCTION opens the two client
// publish paths (the HTTP face POST and the WS-mux `pub` frame) AND mediates every *client* publish (a
// server `publish` bypasses it) — here it stamps a fresh id + `via: "client"` and drops empty messages by
// returning `undefined`. The mediator's presence IS the permission (ADR 0023).
// #demo socket-def
export default socket<ChatMessage>({
    // The pub/sub knobs are the CHANNEL's own, nested rather than flattened (ADR 0027 D1) — a socket
    // adds transport and authorization, not vocabulary.
    channel: { tail: 20 },
    clientPublish: (message) => {
        const text = message && typeof message.text === 'string' ? message.text.trim() : ''
        if (text.length === 0) return
        return { id: crypto.randomUUID(), text, via: 'client' }
    },
})
// #enddemo
