import { json } from 'belte/server'
import { POST } from 'belte/server'

/* POST — args arrive in the JSON request body. */
export const createEcho = POST<{ message: string }>(({ message }) =>
    json({ method: 'POST' as const, message }, { status: 201 }),
)
