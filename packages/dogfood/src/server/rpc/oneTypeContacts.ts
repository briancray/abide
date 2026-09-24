import { GET } from 'abide/server'
import { database } from '#server/oneTypeDatabase'

export const getContact = GET(({ id }: { id: string }) =>
    database.contacts.find(id),
)
