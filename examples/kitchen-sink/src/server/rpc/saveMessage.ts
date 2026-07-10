import { error } from '@abide/abide/server/error'
import { json } from '@abide/abide/server/json'
import { POST } from '@abide/abide/server/POST'
import { z } from 'zod'

const inputSchema = z.object({ id: z.string(), text: z.string() })

/* A message-save write. Calling `saveMessage(msg)` on the client POSTs it to the
   server and returns the saved record. Keyed by the client-supplied id, so a re-send
   is a no-op rather than a duplicate. A text containing "fail" is a 422 rejection the
   page can reconcile (roll back the optimistic write). */
const saved = new Map<string, string>()

export const saveMessage = POST(
    ({ id, text }) => {
        if (text.includes('fail')) {
            return error(422, 'message rejected by the server')
        }
        saved.set(id, text)
        return json({ id, text, total: saved.size }, { status: 201 })
    },
    { schemas: { input: inputSchema } },
)
