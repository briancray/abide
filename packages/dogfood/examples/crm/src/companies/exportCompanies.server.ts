import { rpc } from '@abide/abide/server'

/** Answers at /companies/exportCompanies; the export button calls it. */
export const exportCompanies = rpc(
    async () => {
        // An export worker that has stopped answering.
        throw new Error('the export worker reset the connection')
    },
    { methods: ['POST'], description: 'Exports every company as CSV.' },
)
