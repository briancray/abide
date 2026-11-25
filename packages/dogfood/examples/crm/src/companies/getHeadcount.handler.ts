import { fetchData, GET, isFailed } from '@abide/abide/server'

import { registryOrigin } from './lib/registryOrigin.server.ts'

/** A company's headcount where the registry answers within half a second, else `null`. */
export default GET(
    async ({ id }: { id: string }) => {
        const registration = await fetchData<{ employees: number }>(
            `${registryOrigin()}/companies/${id}`,
            { retries: 0, timeout: 500 },
        )
        return isFailed(registration) ? null : registration.employees
    },
    { description: "A company's headcount, if the registry answers in time." },
)
