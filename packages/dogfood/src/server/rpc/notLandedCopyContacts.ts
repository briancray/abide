import { GET } from '@abide/abide/server'

const EMAILS: Record<string, string> = {
    ada: 'ada@example.com',
    grace: 'grace@example.com',
    katherine: 'katherine@example.com',
}

export const getContact = GET(
    async ({ id }: { id: string }) => {
        // A slow directory, so there is time to press Copy before it lands.
        await Bun.sleep(1500)
        return { id, email: EMAILS[id] ?? '' }
    },
    { description: 'The email of a contact, from a slow directory.' },
)
