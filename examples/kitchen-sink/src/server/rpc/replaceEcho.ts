import { json } from 'belte/server'
import { PUT } from 'belte/server'

/* PUT — args arrive in the JSON request body, same as POST. */
export const replaceEcho = PUT<{ message: string }>(({ message }) =>
    json({ method: 'PUT' as const, message }),
)
