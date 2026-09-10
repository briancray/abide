import { GET, memo } from 'abide/server'

const PEOPLE = ['Ada Lovelace', 'Alan Turing', 'Grace Hopper']

// TAKES ARGS, so it is keyed: one entry per query, held on the first read.
const matching = memo((args: { query: string }) => {
    const word = args.query.toLowerCase()
    return PEOPLE.filter((one) => one.toLowerCase().includes(word))
})

export const searchContacts = GET(matching)
