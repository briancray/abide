import { json } from '@abide/abide/server/json'
import { PATCH } from '@abide/abide/server/PATCH'

/* PATCH — args arrive in the JSON request body. */
export const patchEcho = PATCH<{ message: string }>(({ message }) =>
    json({ method: 'PATCH' as const, message }),
)
