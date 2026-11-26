import { refuse } from '@abide/abide'
import { rpc } from '@abide/abide/server'

import { COMPANIES } from './lib/COMPANIES.server.ts'

/** Answers at /companies/getCompany; a company's page reads it. */
export default rpc(
    async ({ id }: { id: string }) => {
        const company = COMPANIES.find((one) => one.id === id)
        // A miss is answered at once, so the page can say 404.
        if (company === undefined) return refuse.notFound()
        // A slow database, so the page goes out before the company.
        await Bun.sleep(1200)
        return company
    },
    { description: 'One company, by its id.' },
)
