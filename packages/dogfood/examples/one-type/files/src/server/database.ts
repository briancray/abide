// The app data this example stands on, so the download runs on its own. Not
// counted in the line ratio: what the ratio prices is markup, client and
// handler, not the rows underneath them.

export type Contact = { id: string; name: string; email: string }

const CONTACTS: Record<string, Contact> = {
    '1': { id: '1', name: 'Ada Lovelace', email: 'ada@example.com' },
}

export const database = {
    contacts: {
        async find(id: string): Promise<Contact> {
            return CONTACTS[id]
        },
    },
}
