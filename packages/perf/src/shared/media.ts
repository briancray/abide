// The media page's data, modelled on ~/code/media's `MediaStub` — the fields its poster and detail
// components actually branch on. Derived purely from an id, like `rows.ts`, so a server render and a
// client rebuild agree without seeding anything across the wire.
//
// Kept apart from `rows.ts` deliberately: that file is copied byte-identical into the other two
// repos for the three-way comparison, and this page is now in all three.

export interface Media {
    id: number
    title: string
    type: 'series' | 'season' | 'episode'
    status: 'returning' | 'ended' | 'upcoming'
    matched: boolean
    available: boolean
    seasonCount: number
    episodeCount: number
    releaseYear: number
    addedAt: number
    watchedAt: number
    progress: number
}

const TITLE_HEADS = [
    'the', 'a', 'my', 'our', 'their', 'one', 'last', 'first', 'next', 'lost',
]

const TITLE_BODIES = [
    'winter', 'harbour', 'signal', 'orchard', 'lantern', 'quarry', 'meridian', 'saltwater',
    'foundry', 'thicket', 'reservoir', 'almanac', 'catalogue', 'observatory', 'wireline',
]

const TITLE_TAILS = ['story', 'files', 'season', 'report', 'letters', 'diaries', 'circuit']

const TYPES = ['series', 'season', 'episode'] as const
const STATUSES = ['returning', 'ended', 'upcoming'] as const

export function titleFor(id: number): string {
    const head = TITLE_HEADS[id % TITLE_HEADS.length] as string
    const body = TITLE_BODIES[(id >> 2) % TITLE_BODIES.length] as string
    const tail = TITLE_TAILS[(id >> 5) % TITLE_TAILS.length] as string
    return `${head} ${body} ${tail}`
}

export function buildMedia(from: number, count: number): Media[] {
    const media: Media[] = []
    for (let i = 0; i < count; i++) {
        const id = from + i
        media.push({
            id,
            title: titleFor(id),
            type: TYPES[id % TYPES.length] as 'series' | 'season' | 'episode',
            status: STATUSES[(id >> 1) % STATUSES.length] as 'returning' | 'ended' | 'upcoming',
            matched: id % 7 !== 0,
            available: id % 3 !== 0,
            seasonCount: (id % 6) + 1,
            episodeCount: ((id * 13) % 24) + 1,
            releaseYear: 1975 + (id % 50),
            // The three sort keys are deliberately UNCORRELATED with each other and with id, so
            // changing the sort is a genuine reorder of the same rows rather than a near-identity.
            addedAt: (id * 7919) % 100000,
            watchedAt: (id * 104729) % 100000,
            progress: (id * 37) % 101,
        })
    }
    return media
}
