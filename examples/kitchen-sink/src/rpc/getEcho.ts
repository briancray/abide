import { GET } from 'belte/rpc'
import { json } from 'belte/response'

/* GET — args arrive as URL search params. */
export const getEcho = GET<{ message: string }, { method: 'GET'; message: string }>(({ message }) =>
    json({ method: 'GET', message }),
)
