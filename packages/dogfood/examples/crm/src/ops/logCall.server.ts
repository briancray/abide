import { rpc } from '@abide/abide/server'

import { type Call, listCalls } from './listCalls.server.ts'

/** Logs a call once, however often it is sent: the browser picks its id. */
export const logCall = rpc(
    ({ id, note }: Call) => {
        listCalls.patch((held) => {
            if (!held.some((call) => call.id === id)) held.push({ id, note })
        })
    },
    { methods: ['POST'], description: 'Logs a call against a contact.' },
)
