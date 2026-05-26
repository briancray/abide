import { json } from 'belte/respond'
import { PATCH } from 'belte/route'

/* PATCH — args arrive in the JSON request body. */
export const patchEcho = PATCH<{ message: string }>(({ message }) =>
    json({ method: 'PATCH' as const, message }),
)
