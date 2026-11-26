import { rpc } from '@abide/abide/server'

import { COMPANIES } from './lib/COMPANIES.server.ts'

/** Answers at /companies/listCompanies; the list page reads it. */
export default rpc(async () => COMPANIES, {
    description: 'Every company.',
})
