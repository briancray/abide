import { GET } from 'abide/server'

const PEOPLE: Record<string, { name: string; role: string }> = {
    '1': { name: 'Ada Lovelace', role: 'Engineer' },
    '2': { name: 'Grace Hopper', role: 'Admiral' },
}

// A CRM's own audit column, kept here so the example is one file.
const OPENED = new Map<string, number>()

// ONE PARAMETER, so this is a keyed memo: an entry per args key,
// and the entry is what a caller adopts. It runs once per request
// that reaches it, which is what makes `opened` say something a
// count taken on the client could not.
export const getProfile = GET((args: { id: string }) => {
    const opened = (OPENED.get(args.id) ?? 0) + 1
    OPENED.set(args.id, opened)
    return { ...PEOPLE[args.id], opened }
})
