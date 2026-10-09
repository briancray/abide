import { GET } from 'abide/server'

const PEOPLE: Record<string, { name: string; role: string }> = {
    '1': { name: 'Ada Lovelace', role: 'Engineer' },
    '2': { name: 'Grace Hopper', role: 'Admiral' },
}

/** A CRM's own audit column, kept here so the example is one file. */
const OPENED = new Map<string, number>()

/** Runs once per request that reaches it, so `opened` counts loads. */
export const getProfile = GET(
    async (args: { id: string }) => {
        // A slow service, so the wait is on screen.
        await Bun.sleep(450)
        const opened = (OPENED.get(args.id) ?? 0) + 1
        OPENED.set(args.id, opened)
        return { ...PEOPLE[args.id], opened }
    },
    { description: 'A profile, by id, and how often it was opened.' },
)
