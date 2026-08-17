// How many objects one catalogue entry IS, and the counts that decide it.
//
// A LEAF with no imports of its own, and that is the whole reason it is a file. `Data.abide` wants
// exactly one number out of `catalogue.ts` — `OBJECTS_PER_ENTRY`, for one line of prose — and an
// import edge is priced by the module it lands on, not by the name it asks for. Taken from
// `catalogue.ts` it dragged `buildCatalogue`, `imageFor`, `peopleFor`, `seasonsFor` and the two name
// tables into the `/demos/[name]` route chunk, where none of them can ever run: the only caller is
// `#server/rpc/catalogue.ts`, behind the `server/rpc/**` elision. ~6 kB shipped to every demo page,
// including `/demos/simple`, for one multiplication.
//
// The builder reads these too, so the counts and the arithmetic over them stay in one place — a
// second `PEOPLE_PER_ENTRY` beside the loop that walks it is how the denominator goes quietly wrong.

export const PEOPLE_PER_ENTRY = 3
export const CREDITS_PER_PERSON = 2
export const SEASONS_PER_ENTRY = 2
export const EPISODES_PER_SEASON = 6

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
