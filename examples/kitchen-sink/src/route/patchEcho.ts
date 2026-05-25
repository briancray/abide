import { PATCH } from 'belte/route'
import { json } from 'belte/respond'

/* PATCH — args arrive in the JSON request body. */
export const patchEcho = PATCH<{ message: string }, { method: 'PATCH'; message: string }>(
    ({ message }) => json({ method: 'PATCH', message }),
)
