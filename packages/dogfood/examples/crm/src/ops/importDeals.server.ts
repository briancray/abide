import { refuse } from '@abide/abide'
import { rpc } from '@abide/abide/server'

import { dealImport } from './lib/dealImport.server.ts'

const importRunning = refuse.named('ImportRunning', {
    status: 409,
    message: 'An import is already running.',
})

/** Starts the import from the old CRM, every deal or those at one stage, and answers at once with where it stands. */
export default rpc(
    async (options: { stage?: string } = {}) => {
        if ((await dealImport.status()).running) return importRunning()
        void dealImport.run(options)
        return dealImport.status()
    },
    {
        methods: ['POST'],
        description:
            'Starts importing deals from the old CRM, every one or those at one stage.',
    },
)
