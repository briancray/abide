import { GET, reactive } from 'abide/server'
import { z } from 'zod'
import { database } from '#server/schemaKeyDatabase'

/** `ABC-123` and `abc-123` are TWO entries and two loads. */
const invoice = reactive(
    (args: { id: string }) => database.invoices.find(args.id),
    { args: z.object({ id: z.string().toLowerCase() }) },
)

export const getInvoice = GET(invoice)
