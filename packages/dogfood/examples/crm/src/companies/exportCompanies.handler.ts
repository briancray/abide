import { POST } from '@abide/abide/server'

/** Answers at /companies/exportCompanies; the export button calls it. */
export default POST(
    async () => {
        // An export worker that has stopped answering.
        throw new Error('the export worker reset the connection')
    },
    { description: 'Exports every company as CSV.' },
)
