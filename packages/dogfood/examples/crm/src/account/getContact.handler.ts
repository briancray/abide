import { principal } from '@abide/abide'
import { GET } from '@abide/abide/server'

type Contact = { name: string; company: string; dealValue?: string }

const CONTACT: Contact = {
    name: 'Grace Hopper',
    company: 'Hopper & Co',
    dealValue: '$48,000',
}

/** The deal value is an admin's to read; everyone else gets the rest. */
export default GET(
    async (): Promise<Contact> => {
        const { dealValue, ...rest } = CONTACT
        const { role } = await principal.resolved
        return role === 'admin' ? CONTACT : rest
    },
    { description: 'A contact, with the deal value for admins only.' },
)
