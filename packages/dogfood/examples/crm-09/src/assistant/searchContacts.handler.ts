import { GET } from '@abide/abide/server'

import { CONTACTS } from '../contacts/lib/CONTACTS.server.ts'

/** One handler: an OpenAPI operation, an MCP tool and a command. */
export default GET(
    ({ name }: { name: string }) =>
        CONTACTS.filter((contact) => contact.name.includes(name)),
    { description: 'The contacts whose name contains `name`.' },
)
