import { GET } from '@abide/abide/server'
import { PREFERENCES } from './lib/PREFERENCES.server.ts'

/** A saved preference, or `null` where none was saved. */
export default GET(
    async ({ name }: { name: string }) => {
        // A slow database, so the wait is on screen.
        await Bun.sleep(300)
        return PREFERENCES[name] ?? null
    },
    { description: 'Reads a saved view preference.' },
)
