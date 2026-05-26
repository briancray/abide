import { json } from 'belte/respond'
import { PUT } from 'belte/route'

/* PUT — args arrive in the JSON request body, same as POST. */
export const replaceEcho = PUT<{ message: string }>(({ message }) =>
    json({ method: 'PUT' as const, message }),
)
