import { GET } from 'abide/server'

/** What this caller may do with the record, which only the server knows. */
export const getViewer = GET(async () => {
    // A slow service, so the wait is on screen.
    await Bun.sleep(1600)
    return { readOnly: true }
})
