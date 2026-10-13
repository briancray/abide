/**
 * Throws, naming both, when a public file claims a route's address or another public file's.
 *
 * 36.13 — the walks that find routes and public files cannot see each other's collisions from
 * inside either one; this is the one place they meet, and naming BOTH is the clause — naming one
 * leaves the reader to find the other. Two `public` directories can claim one address too, since
 * each mounts at the path above it (36.11).
 *
 * THE BUILD AND DEV, and `abide start` trusts the build: `answerRequest` answers a public file
 * AHEAD of any route on the ground that 36.13 makes a collision impossible at run time, and 30.8
 * says dev must resolve an address the way the built app does.
 *
 * `published` is each public file's source path to its address, as `appTree` reads them.
 */
export function refuseAddressCollision(
    pages: readonly { pattern: string }[],
    handlers: readonly { address: string }[],
    published: Map<string, string>,
    command: string,
): void {
    const patterns = new Set<string>()
    for (const page of pages) patterns.add(page.pattern)
    for (const handler of handlers) patterns.add(handler.address)
    const claimed = new Map<string, string>()
    for (const [source, address] of published) {
        if (patterns.has(address))
            throw new Error(
                `${command}: ${source} and the route ${address} claim the same address. RULEBOOK 36.13.`,
            )
        const other = claimed.get(address)
        if (other !== undefined)
            throw new Error(
                `${command}: ${other} and ${source} are both answered at ${address}. RULEBOOK 36.13.`,
            )
        claimed.set(address, source)
    }
}
