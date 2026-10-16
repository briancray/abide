import { GET } from '@abide/abide/server'
import { CONTACTS } from '../contacts/server/CONTACTS.ts'

// Every contact at once: for the export button, not for a model.
export default GET(() => CONTACTS, {
    description: 'Every contact, for the export button.',
    clients: { mcp: false },
})
