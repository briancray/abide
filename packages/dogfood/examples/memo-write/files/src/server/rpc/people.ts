import { GET } from 'abide/server'

// The same person on every call, which is the point: the record
// coming back UNCHANGED is what makes the refill surprising.
export const getPerson = GET((args: { id: string }) => ({
    id: args.id,
    name: 'Ada Lovelace',
}))
