// The `/data` page's payload: what a real API answers with, rather than what a benchmark row looks
// like. `rows.ts` and `media.ts` are FLAT — one object per row, every field a scalar — and a flat
// array is the one shape a JSON reviver, a structured clone and a memo fan all handle at their best.
// This is the other shape: five levels, three nested collections per entry, and a total object count
// about thirty times the row count.
//
// Derived purely from an id, like `rows.ts` and `media.ts`, so the server can build a shard per
// request without a fixture on disk and two shards differ in their DATA rather than only their size.

import { titleFor } from './media.ts'

export interface Image {
    url: string
    width: number
    height: number
    /** A colour a UI would tint the card with — an object per image, three levels down. */
    dominant: { r: number; g: number; b: number }
}

export interface Episode {
    id: number
    title: string
    runtimeMinutes: number
    airedAt: number
    watched: boolean
}

export interface Season {
    number: number
    airedAt: number
    episodes: Episode[]
}

export interface Credit {
    as: string
    episodes: number
}

export interface Person {
    id: number
    name: string
    role: 'cast' | 'director' | 'writer'
    credits: Credit[]
}

export interface CatalogueEntry {
    id: number
    title: string
    kind: 'series' | 'film' | 'documentary'
    status: 'returning' | 'ended' | 'upcoming'
    releaseYear: number
    addedAt: number
    tags: string[]
    artwork: { poster: Image; backdrop: Image }
    ratings: { average: number; count: number; histogram: number[] }
    people: Person[]
    seasons: Season[]
}

const SURNAMES = [
    'okonkwo', 'lindqvist', 'moreau', 'nakamura', 'ferreira', 'abadi', 'novak', 'castellanos',
    'brennan', 'haldane', 'sorrentino', 'vasquez',
]

const FORENAMES = ['ada', 'grace', 'lin', 'ida', 'kai', 'rune', 'nour', 'tam', 'esi', 'bo']

const KINDS = ['series', 'film', 'documentary'] as const
const STATUSES = ['returning', 'ended', 'upcoming'] as const
const ROLES = ['cast', 'director', 'writer'] as const
const TAGS = ['archive', 'restored', 'subtitled', 'hdr', 'dubbed', 'commentary', 'extended', 'silent']

const PEOPLE_PER_ENTRY = 3
const CREDITS_PER_PERSON = 2
const SEASONS_PER_ENTRY = 2
const EPISODES_PER_SEASON = 6
const HISTOGRAM_BUCKETS = 10

/** How many objects and arrays one entry is, so a per-entry memory figure has a denominator. */
export const OBJECTS_PER_ENTRY =
    1 + // the entry
    1 + // tags
    3 + // artwork, and the two images' dominant colours
    2 + // the two images
    2 + // ratings and its histogram
    1 + // people
    PEOPLE_PER_ENTRY * (1 + 1 + CREDITS_PER_PERSON) + // person, its credits array, the credits
    1 + // seasons
    SEASONS_PER_ENTRY * (1 + 1 + EPISODES_PER_SEASON) // season, its episodes array, the episodes

function imageFor(id: number, kind: 'poster' | 'backdrop'): Image {
    const wide = kind === 'backdrop'
    return {
        url: `/art/${id}/${kind}.avif`,
        width: wide ? 1920 : 600,
        height: wide ? 1080 : 900,
        dominant: { r: (id * 37) % 256, g: (id * 61) % 256, b: (id * 89) % 256 },
    }
}

function peopleFor(id: number): Person[] {
    const people: Person[] = []
    for (let i = 0; i < PEOPLE_PER_ENTRY; i++) {
        const seed = id * 7 + i
        const credits: Credit[] = []
        for (let c = 0; c < CREDITS_PER_PERSON; c++) {
            credits.push({
                as: titleFor(seed + c * 11),
                episodes: ((seed * 5 + c) % 40) + 1,
            })
        }
        people.push({
            // Deliberately drawn from a SMALL pool: the `people` memo aggregates credits by person
            // across the whole array, so the ids have to collide for that aggregation to mean
            // anything. A per-entry-unique id would make it a sort of the row count.
            id: seed % 97,
            name: `${FORENAMES[seed % FORENAMES.length]} ${SURNAMES[seed % SURNAMES.length]}`,
            role: ROLES[i % ROLES.length] as 'cast' | 'director' | 'writer',
            credits,
        })
    }
    return people
}

function seasonsFor(id: number): Season[] {
    const seasons: Season[] = []
    for (let s = 0; s < SEASONS_PER_ENTRY; s++) {
        const episodes: Episode[] = []
        for (let e = 0; e < EPISODES_PER_SEASON; e++) {
            const seed = id * 100 + s * 10 + e
            episodes.push({
                id: seed,
                title: titleFor(seed),
                runtimeMinutes: 22 + (seed % 40),
                airedAt: (seed * 7919) % 100000,
                watched: seed % 3 !== 0,
            })
        }
        seasons.push({ number: s + 1, airedAt: (id * 104729 + s) % 100000, episodes })
    }
    return seasons
}

export function buildCatalogue(shard: number, count: number): CatalogueEntry[] {
    const entries: CatalogueEntry[] = []
    // A shard offsets the ids, so two shards are the same SHAPE with different data — a second key
    // is a genuine second payload rather than the first one under another name.
    const from = shard * 10000 + 1
    for (let i = 0; i < count; i++) {
        const id = from + i
        const histogram: number[] = []
        for (let bucket = 0; bucket < HISTOGRAM_BUCKETS; bucket++) {
            histogram.push((id * (bucket + 3)) % 50)
        }
        const tags: string[] = []
        for (let t = 0; t < 4; t++) tags.push(TAGS[(id + t * 3) % TAGS.length] as string)
        entries.push({
            id,
            title: titleFor(id),
            kind: KINDS[id % KINDS.length] as 'series' | 'film' | 'documentary',
            status: STATUSES[(id >> 1) % STATUSES.length] as 'returning' | 'ended' | 'upcoming',
            releaseYear: 1975 + (id % 50),
            addedAt: (id * 7919) % 100000,
            tags,
            artwork: { poster: imageFor(id, 'poster'), backdrop: imageFor(id, 'backdrop') },
            ratings: {
                average: Math.round((30 + ((id * 13) % 70)) / 10) / 1,
                count: (id * 311) % 5000,
                histogram,
            },
            people: peopleFor(id),
            seasons: seasonsFor(id),
        })
    }
    return entries
}
