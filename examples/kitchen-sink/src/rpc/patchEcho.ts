import { PATCH } from 'belte/rpc'
import { json } from 'belte/response'

/* PATCH — args arrive in the JSON request body. */
export const patchEcho = PATCH<{ message: string }, { method: 'PATCH'; message: string }>(
    ({ message }) => json({ method: 'PATCH', message }),
)
