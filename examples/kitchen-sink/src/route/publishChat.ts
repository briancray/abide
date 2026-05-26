import { error, json } from 'belte/respond'
import { POST } from 'belte/route'
import { type ChatMessage, chat } from '$stream/chat.ts'

/*
POST handler that records a chat message and publishes it to the
`chat` stream. Anyone subscribed to that stream — whether through
`for await (const m of chat)` on the server or `subscribe(chat)` on
the client — receives the message. Validation happens here because
`chat` is declared without `clientPublish: true`, so the browser
can't publish directly; the auth/sanitisation gate lives in this
route.
*/
export const publishChat = POST<{ from: string; text: string }>(({ from, text }) => {
    const trimmedFrom = from.trim()
    const trimmedText = text.trim()
    if (!trimmedFrom || !trimmedText) {
        return error(400, 'from and text are required')
    }
    const message: ChatMessage = {
        id: crypto.randomUUID(),
        from: trimmedFrom,
        text: trimmedText,
        at: Date.now(),
    }
    chat.publish(message)
    return json(message)
})
