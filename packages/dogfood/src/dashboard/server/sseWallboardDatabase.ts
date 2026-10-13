// The app data this example stands on.

export type Visit = { page: string; at: string }

const LATEST: Visit[] = [
    { page: '/pricing', at: '09:41:02' },
    { page: '/signup', at: '09:41:05' },
    { page: '/docs', at: '09:41:09' },
]

/** A live feed, cut to three visits so the answer closes. */
export const sseWallboardDatabase = {
    visits: {
        async *latest(): AsyncGenerator<Visit> {
            for (const visit of LATEST) {
                await Bun.sleep(300)
                yield visit
            }
        },
    },
}
