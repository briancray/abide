import { principal, refuse } from '@abide/abide'
import { POST } from '@abide/abide/server'

import { CONTACTS } from '../contacts/lib/CONTACTS.server.ts'

export default POST(async () => CONTACTS, {
    description: 'Every contact, for an admin to export.',
    middleware: [
        // Runs before the handler, on every call, in process or not.
        async (next, ctx) => {
            const { role } = await principal.resolved
            if (role !== 'admin') return refuse(403, 'Admins only.')
            return next(ctx)
        },
    ],
})
