import { principal, refuse } from 'abide'
import { GET, reactive } from 'abide/server'
import { z } from 'zod'
import { database } from '#server/rungOrderDatabase'

const found = reactive(
    ({ limit }: { limit: number }) => database.invoices.recent(limit),
    { args: z.object({ limit: z.number().int().min(1).max(3) }) },
)

export const searchInvoices = GET(found, {
    middleware: [
        async (next, ctx) => {
            if (!(await principal.authenticated))
                return refuse(401, 'Sign in first.')
            return next(ctx)
        },
    ],
})
