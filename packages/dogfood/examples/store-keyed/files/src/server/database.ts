// The app data this example stands on, so the download runs on its own. Not
// counted in the line ratio: what the ratio prices is markup, client and
// handler, not the rows underneath them.

export type Settings = { theme: string }

const BY_PROFILE: Record<string, Settings> = {
    ada: { theme: 'dark' },
    grace: { theme: 'light' },
}

export const database = {
    settings: {
        async forProfile(profile: string): Promise<Settings> {
            return BY_PROFILE[profile] ?? { theme: 'dark' }
        },
    },
}
