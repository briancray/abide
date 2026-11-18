import { fetchJson, GET } from '@abide/abide/server'

import { registryOrigin } from './lib/registryOrigin.server.ts'

type Registration = { founded: number; employees: number }

/** A company's entry at the registry, held a minute, or why it gave up. */
export default GET(
    ({ id }: { id: string }) =>
        fetchJson<Registration>(`${registryOrigin()}/companies/${id}`, {
            ttl: 60_000,
        }),
    { description: "A company's entry at the business registry." },
)
