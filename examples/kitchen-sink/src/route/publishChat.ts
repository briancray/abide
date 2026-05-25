import { POST } from 'belte/route'
import { json, error } from 'belte/respond'
import { server } from 'belte/server'
import { appendChat, type ChatMessage } from '../chatState.ts'

/*
POST that records a chat message and broadcasts it two ways:
- in-process fan-out for SOCKET subscribers reading watchChat()
- the live `Bun.Server` proxy (`server.publish`) for any raw ws
  subscribers — used here to show off the `server` import from
  belte/server, which is a stable module-scope reference.

`error(...)` from belte/respond is the typed-error path; the client
sees an HttpError with status 400.
*/
export const publishChat = POST<{ from: string; text: string }, ChatMessage>(({ from, text }) => {
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
    appendChat(message)
    server.publish('chat', JSON.stringify(message))
    return json(message)
})
