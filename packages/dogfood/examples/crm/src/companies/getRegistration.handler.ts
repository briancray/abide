import { refuse } from '@abide/abide'
import { fetchData, GET, isFailed } from '@abide/abide/server'

import { registryOrigin } from './lib/registryOrigin.server.ts'

type Registration = { founded: number; employees: number }

/** A company's entry at the registry, held a minute, or why it gave up. */
export default GET(
    async ({ id }: { id: string }) => {
        const registration = await fetchData<Registration>(
            `${registryOrigin()}/companies/${id}`,
            { ttl: 60_000 },
        )
        // A company the registry has never heard of is one the CRM has not either.
        if (isFailed(registration) && registration.data.status === 404)
            return refuse(404)
        return registration
    },
    { description: "A company's entry at the business registry." },
)
