import { GET } from 'abide/server'

const CONTACTS: Record<string, { name: string; role: string }> = {
    '42': { name: 'Ada Lovelace', role: 'Engineer' },
}

export const getContact = GET((args: { id: string }) => CONTACTS[args.id])
