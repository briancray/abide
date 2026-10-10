import { GET, reactive } from '@abide/abide/server'

const PEOPLE = ['Ada Lovelace', 'Alan Turing', 'Grace Hopper']

/** TAKES ARGS, so it is keyed: one entry per query, held on the first read. */
const matching = reactive(async (args: { query: string }) => {
    // A slow service, so the wait is on screen.
    await Bun.sleep(450)
    const word = args.query.toLowerCase()
    return PEOPLE.filter((one) => one.toLowerCase().includes(word))
})

export const searchContacts = GET(matching, {
    description: 'Contacts whose name contains a query.',
})
