import { DELETE } from 'belte/rpc'
import { json } from 'belte/response'

/* DELETE — args arrive as URL search params (no body for DELETE/HEAD/GET). */
export const deleteEcho = DELETE<{ message: string }, { method: 'DELETE'; message: string }>(
    ({ message }) => json({ method: 'DELETE', message }),
)
