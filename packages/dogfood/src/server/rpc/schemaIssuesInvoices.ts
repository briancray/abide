import { GET, reactive } from 'abide/server'
import { z } from 'zod'
import { database } from '#server/schemaIssuesDatabase'

const found = reactive(
    ({ query, limit }: { query: string; limit: number }) =>
        database.invoices.search(query, limit),
    {
        args: z.object({
            query: z.string().min(2, 'Type at least two characters.'),
            limit: z.number().int().min(1).max(3, 'Between 1 and 3.'),
        }),
    },
)

export const searchInvoices = GET(found)
