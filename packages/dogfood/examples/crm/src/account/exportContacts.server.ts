import { rpc } from '@abide/abide/server'

import { CONTACTS } from '../contacts/lib/CONTACTS.server.ts'
import { adminsOnly } from './lib/adminsOnly.ts'

export const exportContacts = rpc(async () => CONTACTS, {
    methods: ['POST'],
    description: 'Every contact, for an admin to export.',
    // Runs before the handler, on every call, in process or not.
    middleware: [adminsOnly],
})
