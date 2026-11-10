import type { Found } from '#shared/matchRoute.ts'

/**
 * What a navigation knows before it asks anything: where it is going, and what stands.
 *
 * `match` is the router's own, so 16.10's mount and 30.9's ranking are decided where they always
 * were.
 */
export type Bearing<RouteRow> = {
    target: URL
    /** The document's origin, which an address outside of is no route (30.10). */
    origin: string
    /** 35.18 — the document is an error page's, so leaving it is a document load. */
    errorPage: boolean
    /** The route the standing page was matched by. */
    standing: RouteRow | undefined
    /** The path the standing chain was mounted for. */
    mounted: string | undefined
    match: (pathname: string) => Found<RouteRow> | undefined
}

/** What the ask and the load came back with (30.15). */
export type Heard<RouteRow> = {
    /** The route the ask was made for — the `ask` outcome's `found`. */
    found: Found<RouteRow>
    /** The server's answer; `undefined` where the fetch failed. */
    answer: { status: number; url: string; redirected: boolean } | undefined
    /** Whether the asked-for route's chunks loaded. */
    loaded: boolean
    online: boolean
    /** Whether the navigation pushes, rather than arriving at a history step the bar already took. */
    pushed: boolean
}

/**
 * How a navigation ends.
 *
 * `document` hands `href` to a document load. `follow` moves the address within the standing page.
 * `ask` is the first call's answer where the server must be asked first. `offline` is 30.32's: the
 * page stays, unless the service worker saved `href` (45.12). `mount` mounts `found` at `at`.
 */
type Outcome<RouteRow> =
    | Settled<RouteRow>
    | { kind: 'ask'; found: Found<RouteRow> }
    | { kind: 'offline'; href: string }
    | { kind: 'mount'; at: URL; found: Found<RouteRow> }

/** An outcome that loads nothing, which either call can answer. */
export type Settled<RouteRow> =
    | { kind: 'document'; href: string }
    | { kind: 'follow'; at: URL; found: Found<RouteRow> }

/**
 * Decides how a navigation ends, from what it knows: called once before the ask, and once more
 * with what was `heard` where the first call answered `ask`.
 *
 * Decides and touches nothing — the router executes the answer. A `mount` whose `found` is not
 * `heard.found` lands on a route whose chunks were not loaded yet, and the router hands that
 * address to the document where they will not load (30.27).
 */
export function outcomeOf<RouteRow>(
    bearing: Bearing<RouteRow>,
): Settled<RouteRow> | Extract<Outcome<RouteRow>, { kind: 'ask' }>
export function outcomeOf<RouteRow>(
    bearing: Bearing<RouteRow>,
    heard: Heard<RouteRow>,
): Settled<RouteRow> | Extract<Outcome<RouteRow>, { kind: 'offline' | 'mount' }>
export function outcomeOf<RouteRow>(
    bearing: Bearing<RouteRow>,
    heard?: Heard<RouteRow>,
): Outcome<RouteRow> {
    const target = bearing.target
    if (heard === undefined) {
        // A CROSS-ORIGIN ADDRESS IS NOT A ROUTE. Handing it to `pushState` throws, and treating
        // it as a miss would leave the caller with a navigation that silently did nothing.
        if (target.origin !== bearing.origin || bearing.errorPage)
            return { kind: 'document', href: target.href }
        const found = bearing.match(target.pathname)
        // 30.10 — NOT A ROUTE THIS BUILD KNOWS, so it is the server's to answer — which is a
        // document load, and the one case where 30.7 does not apply because there is no route.
        if (found === undefined) return { kind: 'document', href: target.href }
        // 30.21, 30.23, 30.24 — THE ROUTE STANDING, AT ITS OWN PATH: another query, another
        // fragment or the same address. The page reads its address through `route`, so it follows
        // rather than being rebuilt, and there is no path for `middleware` to decide anything new
        // about.
        if (
            found.route === bearing.standing &&
            bearing.mounted === target.pathname
        )
            return { kind: 'follow', at: target, found }
        return { kind: 'ask', found }
    }
    const answer = heard.answer
    // 30.32 — OFFLINE, THE DOCUMENT LOAD BELOW CAN ONLY PAINT THE BROWSER'S ERROR PAGE over a page
    // that works. A history step has already moved the bar, so it is left to the document.
    if (answer === undefined && !heard.online && heard.pushed)
        return { kind: 'offline', href: target.href }
    // 30.18 — A REFUSAL, A RESPONSE MIDDLEWARE ANSWERED ITSELF, or no answer at all: the document
    // asks again and paints whatever the server says. A fetch that failed — offline, or a redirect
    // to another origin that CORS will not let it follow — goes to the address it was sent to.
    // 30.27 — AND CHUNKS THAT WOULD NOT LOAD, with the server down or a deploy that removed them.
    if (answer?.status !== 204 || !heard.loaded)
        return { kind: 'document', href: answer?.url ?? target.href }
    // 30.17 — REDIRECTED, and the server already said yes to where it landed: the answer is the
    // 204 at the end of the chain. That address is mounted in place of the one asked for, and a
    // route the client has no row for is the document's (30.10).
    const landed = answer.redirected ? new URL(answer.url) : target
    const landing = answer.redirected
        ? bearing.match(landed.pathname)
        : heard.found
    if (landing === undefined) return { kind: 'document', href: landed.href }
    // 30.23 — THE ROUTE STANDING, AT ANOTHER PATH: `middleware` has said yes to the path, and the
    // page it matched is the one already mounted, so it follows.
    if (landing.route === bearing.standing)
        return { kind: 'follow', at: landed, found: landing }
    return { kind: 'mount', at: landed, found: landing }
}
