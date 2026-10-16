import { GET } from '@abide/abide/server'
import { COMPANIES } from './server/COMPANIES.ts'

/** Answers at /companies/listCompanies; the list page reads it. */
export default GET(async () => COMPANIES, {
    description: 'Every company.',
})
