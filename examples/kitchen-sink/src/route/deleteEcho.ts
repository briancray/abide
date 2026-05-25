import { DELETE } from 'belte/route'
import { json } from 'belte/respond'

/* DELETE — args arrive as URL search params (no body for DELETE/HEAD/GET). */
export const deleteEcho = DELETE<{ message: string }, { method: 'DELETE'; message: string }>(
    ({ message }) => json({ method: 'DELETE', message }),
)
