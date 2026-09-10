import { GET, memo } from 'abide/server'
import { z } from 'zod'
import { database } from '#server/database'

const found = memo(
    ({ query, limit }: { query: string; limit: number }) =>
        database.invoices.search(query, limit),
    {
        schema: z.object({
            query: z.string().min(2, 'Type at least two characters.'),
            limit: z.number().int().min(1).max(3, 'Between 1 and 3.'),
        }),
    },
)

export const searchInvoices = GET(found)
