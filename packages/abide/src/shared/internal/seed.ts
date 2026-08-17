// What a server render already resolved, handed to the client in the document it rendered.
//
// Without this the browser asks for the payload a SECOND time: the server calls the handler to build
// the markup, the client adopts that markup, and then the client's own memo slot is cold — so the
// first read of it reaches the network for an answer that is already on screen. Measured on the perf
// app's `/data`: a 254 KB document followed by a 623 KB fetch, and the handler ran twice because a
// slot is per-caller and the browser is a different caller. Svelte and Solid both inline the value
// for the same reason; their documents are bigger and nothing follows them.
//
// The key is `keyOf` — what a keyed memo already addresses a slot by — so the two sides compute the
// same string and there is no second convention to keep in step. `seedKey` itself lives in `keys.ts`
// for the first-load reason stated there; this module must not import it back.
//
// Shared rather than per-lane because the KEY has to be, and the two halves either side of it are
// small enough that splitting them would cost an import to save nothing.

import { nonceAttribute } from '../html.ts'

/** Where the document carries it. A data block, never executed — the client parses it. */
export const SEED_ELEMENT_ID = 'abide-seed'

/**
 * `</script` is the only sequence that can end the block early, and it is the only one escaped.
 *
 * The content is JSON, so a `<` can only be inside a string literal, and `<` is that same
 * string to every JSON parser. Escaping more would be a second encoding for the client to undo.
 */
export function seedScript(json: string, nonce: string | null): string {
    const safe = json.replace(/</g, '\\u003c')
    return `<script type="application/json" id="${SEED_ELEMENT_ID}"${nonceAttribute(nonce)}>${safe}</script>`
}

/**
 * The seeds this document carried, read ONCE and lazily.
 *
 * `undefined` until the first ask, so a page with no rpc on it never looks the element up; a `Map`
 * after, empty when the document carried none — which is what stops a second lookup per call.
 */
let SEEDED: Map<string, unknown> | undefined

/**
 * The value the server already resolved for this key, CONSUMED.
 *
 * A record rather than the value itself, because a handler may legitimately have answered
 * `undefined` and a caller has to tell that from "nothing was seeded" — the same distinction
 * `peek()` draws, and for the same reason.
 *
 * Consumed on the first take so the slot behaves exactly as a loaded one from then on: an
 * `invalidate` goes back to cold and the next read reaches the network, which is what it is for.
 */
export function takeSeed(key: string): { value: unknown } | null {
    if (SEEDED === undefined) SEEDED = readSeeds()
    if (!SEEDED.has(key)) return null
    const value = SEEDED.get(key)
    SEEDED.delete(key)
    return { value }
}

/**
 * What a NAVIGATION carried, merged into the same table.
 *
 * The document's block is read first when nothing has asked yet, because the merge must not be what
 * decides the table exists: a page whose first rpc read comes after a navigation would otherwise
 * find a table holding only what the navigation brought, and the document's own seeds — still
 * unconsumed, still correct for a slot nobody has read — would be dropped on the floor.
 *
 * A key the document also seeded is OVERWRITTEN, and that is the right way round: both answers came
 * from the same handler, and the navigation's is the newer one.
 */
export function addSeeds(json: string): void {
    if (SEEDED === undefined) SEEDED = readSeeds()
    mergeSeeds(json, SEEDED)
}

function readSeeds(): Map<string, unknown> {
    const table = new Map<string, unknown>()
    // A server render reaches this module through `seedKey`, and there is no document to read there.
    if (typeof document === 'undefined') return table
    const held = document.getElementById(SEED_ELEMENT_ID)
    if (held === null || held.textContent === null || held.textContent === '') return table
    mergeSeeds(held.textContent, table)
    return table
}

/**
 * One seed block into `table` — the document's own, or a navigation's. Both arrive as the same text.
 *
 * A block that does not parse is a truncated document: the connection dropped mid-stream. Every slot
 * then loads the ordinary way, which is exactly the behaviour without any of this, so there is
 * nothing to report and nothing to fall back to.
 */
function mergeSeeds(json: string, table: Map<string, unknown>): void {
    try {
        const parsed = JSON.parse(json) as Record<string, unknown>
        for (const key of Object.keys(parsed)) table.set(key, parsed[key])
    } catch {
        // Deliberately silent — see above.
    }
}
