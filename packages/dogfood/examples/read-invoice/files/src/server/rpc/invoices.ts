import { GET } from 'abide/server'
import { database } from '#server/database'

export const getInvoice = GET(({ id }: { id: string }) => database.invoice.find(id))
