import { error } from '@abide/abide/server/error'
import { json } from '@abide/abide/server/json'
import { POST } from '@abide/abide/server/POST'
import { z } from 'zod'

const inputSchema = z.object({ id: z.string(), text: z.string() })

/* The outbox's send target. Keyed by the client-supplied id, so a re-send
   (the queue is at-least-once — a crash between send and dequeue replays it)
   is a no-op rather than a duplicate. A text containing "fail" is a permanent
   422: that's a rejection while still online, which makes the outbox drop the
   entry and call onDrop so the page can roll back its optimistic update. */
const saved = new Map<string, string>()

export const saveMessage = POST(
    ({ id, text }) => {
        if (text.includes('fail')) {
            return error(422, 'message rejected by the server')
        }
        saved.set(id, text)
        return json({ id, text, total: saved.size }, { status: 201 })
    },
    { inputSchema },
)
