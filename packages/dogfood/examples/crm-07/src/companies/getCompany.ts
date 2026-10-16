import { GET, notFound } from '@abide/abide/server'
import { COMPANIES } from './server/COMPANIES.ts'

/** Answers at /companies/getCompany; a company's page reads it. */
export default GET(
    async ({ id }: { id: string }) => {
        const company = COMPANIES.find((one) => one.id === id)
        // A miss is answered at once, so the page can say 404.
        if (company === undefined) return notFound()
        // A slow database, so the page goes out before the company.
        await Bun.sleep(1200)
        return company
    },
    { description: 'One company, by its id.' },
)
