import { GET } from '@abide/abide/server'

const CONTACTS = [
    { name: 'Ada Lovelace', email: 'ada@engines.example' },
    { name: 'Grace Hopper', email: 'grace@hopper.example' },
]

export default GET(() => CONTACTS, {
    description: 'Every contact, for the export button.',
    clients: { mcp: false },
})
