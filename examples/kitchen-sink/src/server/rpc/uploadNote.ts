import { json } from '@belte/belte/server/json'
import { POST } from '@belte/belte/server/POST'
import { z } from 'zod'

/*
Multipart upload. The call site sends a FormData (body verbs accept one in
place of typed args); parseArgs splits it — text fields become args validated
by inputSchema, File parts group by field name and are validated by
filesSchema, then merged into the handler's args bag. Files stay out of
inputSchema so its JSON-Schema projection (OpenAPI/MCP/CLI) never has to
model a binary. Either schema's issues come back as a 422.
*/
const inputSchema = z.object({ title: z.string() })
const filesSchema = z.object({ attachments: z.array(z.instanceof(File)).min(1) })

export const uploadNote = POST(
    ({ title, attachments }) =>
        json({
            title,
            attachments: attachments.map((file) => ({ name: file.name, bytes: file.size })),
        }),
    { inputSchema, filesSchema },
)
