import { GET, memo } from 'abide/server'
import { z } from 'zod'
import { database } from '#server/database'

// `ABC-123` and `abc-123` are TWO entries and two loads.
const invoice = memo(
    (args: { id: string }) => database.invoices.find(args.id),
    { schema: z.object({ id: z.string().toLowerCase() }) },
)

export const getInvoice = GET(invoice)
