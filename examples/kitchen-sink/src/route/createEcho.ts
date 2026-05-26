import { json } from 'belte/respond'
import { POST } from 'belte/route'

/* POST — args arrive in the JSON request body. */
export const createEcho = POST<{ message: string }>(({ message }) =>
    json({ method: 'POST' as const, message }, { status: 201 }),
)
