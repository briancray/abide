import { json } from 'belte/respond'
import { DELETE } from 'belte/route'

/* DELETE — args arrive as URL search params (no body for DELETE/HEAD/GET). */
export const deleteEcho = DELETE<{ message: string }>(({ message }) =>
    json({ method: 'DELETE' as const, message }),
)
