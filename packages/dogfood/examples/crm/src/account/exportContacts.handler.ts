import { POST } from '@abide/abide/server'

import { CONTACTS } from '../contacts/lib/CONTACTS.server.ts'
import { adminsOnly } from './lib/adminsOnly.ts'

export default POST(async () => CONTACTS, {
    description: 'Every contact, for an admin to export.',
    // Runs before the handler, on every call, in process or not.
    middleware: [adminsOnly],
})
