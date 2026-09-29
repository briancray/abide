import { GET } from 'abide/server'

/** The same person on every call, so a refill changes no field. */
export const getPerson = GET(async (args: { id: string }) => {
    // A slow service, so the wait is on screen.
    await Bun.sleep(450)
    return { id: args.id, name: 'Ada Lovelace' }
})
