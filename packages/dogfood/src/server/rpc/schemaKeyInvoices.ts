import { GET, reactive } from '@abide/abide/server'
import { z } from 'zod'
import { schemaKeyDatabase } from '#server/schemaKeyDatabase'

/** `ABC-123` and `abc-123` are TWO entries and two loads. */
const invoice = reactive(
    (args: { id: string }) => schemaKeyDatabase.invoices.find(args.id),
    { args: z.object({ id: z.string().toLowerCase() }) },
)

export const getInvoice = GET(invoice, { description: 'An invoice, by id.' })
