import { POST } from 'belte/rpc'
import { json } from 'belte/response'

/* POST — args arrive in the JSON request body. */
export const createEcho = POST<{ message: string }, { method: 'POST'; message: string }>(
    ({ message }) => json({ method: 'POST', message }, { status: 201 }),
)
