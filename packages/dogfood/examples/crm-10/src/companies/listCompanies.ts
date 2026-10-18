import { GET } from '@abide/abide/server'
import { COMPANIES } from './lib/COMPANIES.server.ts'

/** Answers at /companies/listCompanies; the list page reads it. */
export default GET(async () => COMPANIES, {
    description: 'Every company.',
})
