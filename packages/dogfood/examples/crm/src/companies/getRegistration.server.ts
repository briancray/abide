import { refuse } from '@abide/abide'
import { fetchAndHandle, rpc } from '@abide/abide/server'

import { askRegistry } from './lib/askRegistry.server.ts'

/** A company's entry at the registry, held a minute, or why it gave up. */
export const getRegistration = rpc(
    async ({ id }: { id: string }) => {
        try {
            return await askRegistry(id)
        } catch (failed) {
            // A company the registry has never heard of is one the CRM has not either.
            if (
                fetchAndHandle.isError(failed, 'FetchFailed') &&
                failed.data.status === 404
            )
                return refuse(404)
            throw failed
        }
    },
    // Each company's answer held a minute, for every caller.
    {
        global: true,
        ttl: 60_000,
        description: "A company's entry at the business registry.",
    },
)
