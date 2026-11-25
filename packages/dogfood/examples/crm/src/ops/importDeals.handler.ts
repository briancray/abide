import { refuse } from '@abide/abide'
import { POST } from '@abide/abide/server'

import { dealImport } from './lib/dealImport.server.ts'

const importRunning = refuse.named(
    'ImportRunning',
    409,
    'An import is already running.',
)

/** Starts the import from the old CRM, every deal or those at one stage, and answers at once with where it stands. */
export default POST(
    (options: { stage?: string } = {}) => {
        if (dealImport.status.peek()?.running) return importRunning()
        void dealImport.run(options)
        return dealImport.status.peek()
    },
    {
        description:
            'Starts importing deals from the old CRM, every one or those at one stage.',
    },
)
