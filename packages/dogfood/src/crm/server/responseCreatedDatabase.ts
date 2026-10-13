// The app data this example stands on.

export type Contact = { id: string; name: string }

let next = 4031

/** A slow database, so the wait is on screen. */
export const responseCreatedDatabase = {
    contacts: {
        async add(name: string): Promise<Contact> {
            await Bun.sleep(400)
            const id = String(next)
            next += 1
            return { id, name }
        },
    },
}
