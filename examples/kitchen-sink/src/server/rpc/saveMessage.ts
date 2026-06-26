import { error } from '@abide/abide/server/error'
import { json } from '@abide/abide/server/json'
import { POST } from '@abide/abide/server/POST'
import { z } from 'zod'

const inputSchema = z.object({ id: z.string(), text: z.string() })

/* A durable (`outbox: true`) local-first write. Calling `saveMessage(msg)` on the
   client queues it durably (survives offline + reload) and returns the cancelable
   queued entry; the queue drains on reconnect. Keyed by the client-supplied id, so a
   re-send (at-least-once — a crash between send and dequeue replays it) is a no-op
   rather than a duplicate. A text containing "fail" is a permanent 422: a rejection
   while online, so the entry stays in the outbox with `status: 'error'` for the page
   to reconcile (roll back the optimistic write). */
const saved = new Map<string, string>()

export const saveMessage = POST(
    ({ id, text }) => {
        if (text.includes('fail')) {
            return error(422, 'message rejected by the server')
        }
        saved.set(id, text)
        return json({ id, text, total: saved.size }, { status: 201 })
    },
    { inputSchema, outbox: true },
)
