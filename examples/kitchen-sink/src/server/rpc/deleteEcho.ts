import { DELETE } from '@briancray/belte/server/DELETE'
import { json } from '@briancray/belte/server/json'

/* DELETE — args arrive as URL search params (no body for DELETE/HEAD/GET). */
export const deleteEcho = DELETE<{ message: string }>(({ message }) =>
    json({ method: 'DELETE' as const, message }),
)
