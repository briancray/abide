import { refuse, render, response, rpc } from '@abide/abide/server'

import { COMPANIES } from './lib/COMPANIES.server.ts'
import CompanySheet from './lib/CompanySheet.abide'

/** Answers at /companies/previewCompany: an account sheet, as its own page. */
export default rpc(
    async ({ id }: { id: string }) => {
        const company = COMPANIES.find((one) => one.id === id)
        if (company === undefined) return refuse.notFound()
        return response.page(await render(CompanySheet({ company })))
    },
    { description: "A company's account sheet, rendered on its own." },
)
