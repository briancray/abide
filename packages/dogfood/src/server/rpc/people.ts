import { GET } from 'abide/server'

// The same person on every call, which is the point: the record
// coming back UNCHANGED is what makes the refill surprising.
export const getPerson = GET(async (args: { id: string }) => {
    // A slow service, so the wait is on screen.
    await Bun.sleep(450)
    return { id: args.id, name: 'Ada Lovelace' }
})
