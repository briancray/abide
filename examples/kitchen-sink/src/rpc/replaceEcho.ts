import { PUT } from 'belte/rpc'
import { json } from 'belte/response'

/* PUT — args arrive in the JSON request body, same as POST. */
export const replaceEcho = PUT<{ message: string }, { method: 'PUT'; message: string }>(
    ({ message }) => json({ method: 'PUT', message }),
)
