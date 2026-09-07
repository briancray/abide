import { GET } from 'abide/server'

const PEOPLE = ['Ada Lovelace', 'Alan Turing', 'Grace Hopper']

export const searchContacts = GET((args: { query: string }) => {
    const word = args.query.toLowerCase()
    return PEOPLE.filter((one) => one.toLowerCase().includes(word))
})
