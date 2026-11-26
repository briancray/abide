import { refuse } from '@abide/abide'
import { reachable, rpc } from '@abide/abide/server'

import { billingOrigin } from './lib/billingOrigin.server.ts'

/** Refuses at once while billing is down, rather than waiting on every call. */
export default rpc(
    async ({ id }: { id: string }) => {
        const origin = billingOrigin()
        const asked = performance.now()
        if (!(await reachable(origin))) {
            const waited = Math.round(performance.now() - asked)
            return refuse(
                503,
                `Billing is unreachable — refused in ${waited} ms.`,
            )
        }
        await fetch(`${origin}/contacts/${id}`, { method: 'POST' })
    },
    {
        methods: ['POST'],
        description: 'Copies a contact to billing, where billing is reachable.',
    },
)
