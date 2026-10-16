import { GET, notFound, page, render } from '@abide/abide/server'
import CompanySheet from './lib/CompanySheet.abide'
import { COMPANIES } from './server/COMPANIES.ts'

/** Answers at /companies/previewCompany: an account sheet, as its own page. */
export default GET(
    async ({ id }: { id: string }) => {
        const company = COMPANIES.find((one) => one.id === id)
        if (company === undefined) return notFound()
        return page(await render(CompanySheet({ company })))
    },
    { description: "A company's account sheet, rendered on its own." },
)
