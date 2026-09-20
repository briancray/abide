// The app data this example stands on, so the download runs on its own. Not
// counted in the line ratio: what the ratio prices is markup, client and
// handler, not the rows underneath them.
//
// `null` IS THE MISS, and `settingsStore` reads it as one — a setting never
// written is not the same as a setting written as `null`, which is what the
// store's `get` turns into `undefined` so the reactive keeps the initial value
// it was declared with.

const SETTINGS = new Map<string, string>()

export const database = {
    settings: {
        async read(name: string): Promise<string | null> {
            return SETTINGS.get(name) ?? null
        },
        async write(name: string, value: string): Promise<void> {
            SETTINGS.set(name, value)
        },
    },
}
