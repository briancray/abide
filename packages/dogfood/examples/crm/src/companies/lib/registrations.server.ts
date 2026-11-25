import { fetchAndHandle, memo } from '@abide/abide'

import { registryOrigin } from './registryOrigin.server.ts'

/** Each company's registry entry, asked again every hour; an ask that fails keeps the last answer. */
export const registrations = memo(
    ({ id }: { id: string }) =>
        fetchAndHandle<{ founded: number; employees: number }>(
            `${registryOrigin()}/companies/${id}`,
        ),
    { global: true, poll: 3_600_000 },
)
