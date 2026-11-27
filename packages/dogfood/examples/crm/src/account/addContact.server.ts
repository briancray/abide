import { response, rpc } from '@abide/abide/server'

let nextId = 4031

/** Answers 201, and where the new contact lives. */
export const addContact = rpc(
    async ({ name }: { name: string }) => {
        const contact = { id: String(nextId), name }
        nextId += 1
        response().status = 201
        response().headers.set('location', `/contacts/${contact.id}`)
        return contact
    },
    { methods: ['POST'], description: 'Adds a contact.' },
)
