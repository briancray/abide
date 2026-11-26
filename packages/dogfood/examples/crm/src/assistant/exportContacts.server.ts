import { rpc } from '@abide/abide/server'

import { CONTACTS } from '../contacts/lib/CONTACTS.server.ts'

// Every contact at once: for the export button, not for a model.
export default rpc(() => CONTACTS, {
    description: 'Every contact, for the export button.',
    clients: { mcp: false },
})
