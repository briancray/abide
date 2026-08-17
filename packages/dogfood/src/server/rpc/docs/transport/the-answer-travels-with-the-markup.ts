import { GET } from 'abide/server'

/**
 * `seed` is whether a render hands what this resolved to the CLIENT that adopts it. Default ON, and
 * that default is the one that removes a round trip: the server already loaded this to render, so the
 * client's slot starts warm instead of fetching the same answer back.
 *
 * Turning it off is for an answer carrying FIELDS THE PAGE DID NOT RENDER, because seeding puts the
 * whole value in the document and not the part the markup showed. The route below prints `visits`; the
 * trail would be written into the HTML of every page to save a fetch that page may never make — bytes
 * for an answer nobody asked for, and an exposure besides.
 */
export const activity = GET(
    ({ id }: { id: number }) => ({
        id,
        visits: 7,
        trail: ['signed in', 'opened settings', 'signed out'],
    }),
    { seed: false },
)
