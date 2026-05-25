import { GET } from 'belte/route'
import { json } from 'belte/respond'

/* GET — args arrive as URL search params. */
export const getEcho = GET<{ message: string }, { method: 'GET'; message: string }>(({ message }) =>
    json({ method: 'GET', message }),
)
