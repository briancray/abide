import { memo } from '@abide/abide'
import { fetchData } from '@abide/abide/server'

import { registryOrigin } from './registryOrigin.server.ts'

/** Each company's registry entry, asked again every hour; an ask that fails keeps the last answer. */
export const registrations = memo(
    ({ id }: { id: string }) =>
        fetchData<{ founded: number; employees: number }>(
            `${registryOrigin()}/companies/${id}`,
        ),
    { global: true, poll: 3_600_000 },
)
