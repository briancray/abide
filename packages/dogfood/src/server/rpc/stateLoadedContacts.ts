import { refuse } from '@abide/abide'
import { GET } from '@abide/abide/server'

const CONTACTS: Record<string, { name: string; role: string }> = {
    '42': { name: 'Ada Lovelace', role: 'Engineer' },
}

export const getContact = GET(
    async (args: { id: string }) => {
        // A slow service, so the wait is on screen.
        await Bun.sleep(900)
        return CONTACTS[args.id] ?? refuse(404, 'No such contact.')
    },
    { description: 'A contact, by id.' },
)
