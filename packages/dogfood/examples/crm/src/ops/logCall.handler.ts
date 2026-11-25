import { POST } from '@abide/abide/server'

import listCalls, { type Call } from './listCalls.handler.ts'

/** Logs a call once, however often it is sent: the browser picks its id. */
export default POST(
    ({ id, note }: Call) => {
        listCalls.patch((held) => {
            if (!held.some((call) => call.id === id)) held.push({ id, note })
        })
    },
    { description: 'Logs a call against a contact.' },
)
