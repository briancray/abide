import { refuse } from '@abide/abide'
import { fetchAndHandle, rpc } from '@abide/abide/server'

import { registryOrigin } from './lib/registryOrigin.server.ts'

type Registration = { founded: number; employees: number }

/** A company's entry at the registry, held a minute, or why it gave up. */
export default rpc(
    async ({ id }: { id: string }) => {
        try {
            return await fetchAndHandle<Registration>(
                `${registryOrigin()}/companies/${id}`,
            )
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
