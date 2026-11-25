import { fetchData, GET } from '@abide/abide/server'

import { registryOrigin } from './lib/registryOrigin.server.ts'

/** A company's headcount where the registry answers within half a second, else `null`. */
export default GET(
    ({ id }: { id: string }) =>
        fetchData<{ employees: number }>(
            `${registryOrigin()}/companies/${id}`,
            { retries: 0, timeout: 500 },
        ).then(
            (registration) => registration.employees,
            () => null,
        ),
    { description: "A company's headcount, if the registry answers in time." },
)
