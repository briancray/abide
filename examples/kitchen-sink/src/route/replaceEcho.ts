import { PUT } from 'belte/route'
import { json } from 'belte/respond'

/* PUT — args arrive in the JSON request body, same as POST. */
export const replaceEcho = PUT<{ message: string }, { method: 'PUT'; message: string }>(
    ({ message }) => json({ method: 'PUT', message }),
)
