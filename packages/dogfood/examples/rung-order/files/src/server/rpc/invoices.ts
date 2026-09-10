import { principal, refuse } from 'abide'
import { GET, memo } from 'abide/server'
import { z } from 'zod'
import { database } from '#server/database'

const found = memo(
    ({ limit }: { limit: number }) => database.invoices.recent(limit),
    { schema: z.object({ limit: z.number().int().min(1).max(3) }) },
)

export const searchInvoices = GET(found, {
    middleware: [
        (next, ctx) => {
            if (!principal.authenticated) return refuse(401, 'Sign in first.')
            return next(ctx)
        },
    ],
})
