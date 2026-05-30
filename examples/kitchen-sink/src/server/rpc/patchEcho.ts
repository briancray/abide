import { json } from '@briancray/belte/server/json'
import { PATCH } from '@briancray/belte/server/PATCH'

/* PATCH — args arrive in the JSON request body. */
export const patchEcho = PATCH<{ message: string }>(({ message }) =>
    json({ method: 'PATCH' as const, message }),
)
