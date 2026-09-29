// The app data this example stands on.
//
// `null` FOR AN UNKNOWN EMAIL rather than a throw, because the handler's
// refusal is the example: 401 with a message is what a caller gets, and a
// fixture that threw would make that path a crash instead.

export type User = { id: string; name: string }

const USERS: Record<string, User> = {
    'ada@example.com': { id: 'ada', name: 'Ada Lovelace' },
}

/** A slow database, so the wait is on screen. */
export const database = {
    users: {
        async byEmail(email: string): Promise<User | null> {
            await Bun.sleep(450)
            return USERS[email] ?? null
        },
    },
}
