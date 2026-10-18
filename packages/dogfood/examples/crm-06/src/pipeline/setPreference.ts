import { POST } from '@abide/abide/server'
import { PREFERENCES } from './lib/PREFERENCES.server.ts'

/** Saves a preference. */
export default POST(
    ({ name, value }: { name: string; value: string }) => {
        PREFERENCES[name] = value
    },
    { description: 'Saves a view preference.' },
)
