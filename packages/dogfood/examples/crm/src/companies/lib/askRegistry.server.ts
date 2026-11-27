import { fetchAndHandle, pipe } from '@abide/abide'

import { registryOrigin } from './registryOrigin.server.ts'

/** A company's entry at the registry: the year it was founded and its headcount. */
export type Registration = { founded: number; employees: number }

/** The registry asked for a company's entry, four companies at a time, a busy answer asked twice more. */
export const askRegistry = pipe(
    [
        (id: string, signal: AbortSignal) =>
            fetchAndHandle<Registration>(
                `${registryOrigin()}/companies/${id}`,
                { signal },
            ),
    ],
    { concurrency: 4, retries: 2 },
)
