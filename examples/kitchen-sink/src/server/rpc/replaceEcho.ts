import { json } from '@belte/belte/server/json'
import { PUT } from '@belte/belte/server/PUT'

/* PUT — args arrive in the JSON request body, same as POST. */
export const replaceEcho = PUT<{ message: string }>(({ message }) =>
    json({ method: 'PUT' as const, message }),
)
