import { POST, response } from '@abide/abide/server'

let nextId = 4031

/** Answers 201, and where the new contact lives. */
export default POST(
    async ({ name }: { name: string }) => {
        const contact = { id: String(nextId), name }
        nextId += 1
        response().status = 201
        response().headers.set('location', `/contacts/${contact.id}`)
        return contact
    },
    { description: 'Adds a contact.' },
)
