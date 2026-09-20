// The app data this example stands on, so the download runs on its own. Not
// counted in the line ratio: what the ratio prices is markup, client and
// handler, not the rows underneath them.
//
// `null` FOR AN UNKNOWN EMAIL rather than a throw, because the handler's
// refusal is the example: 401 with a message is what a caller gets, and a
// fixture that threw would make that path a crash instead.

export type User = { id: string; name: string }

const USERS: Record<string, User> = {
    'ada@example.com': { id: 'ada', name: 'Ada Lovelace' },
}

export const database = {
    users: {
        async byEmail(email: string): Promise<User | null> {
            return USERS[email] ?? null
        },
    },
}
