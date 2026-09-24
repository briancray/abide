// The app data this example stands on.

export type Contact = { id: string; name: string; email: string }

const CONTACTS: Record<string, Contact> = {
    '1': { id: '1', name: 'Ada Lovelace', email: 'ada@example.com' },
}

// A slow database, so the wait is on screen.
export const database = {
    contacts: {
        async find(id: string): Promise<Contact> {
            await Bun.sleep(900)
            const row = CONTACTS[id]
            if (row === undefined) throw new Error(`no row ${id}`)
            return row
        },
    },
}
