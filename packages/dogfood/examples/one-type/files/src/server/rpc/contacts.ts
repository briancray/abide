import { GET } from 'abide/server'
import { database } from '#server/database'

export const getContact = GET(({ id }: { id: string }) =>
    database.contacts.find(id),
)
