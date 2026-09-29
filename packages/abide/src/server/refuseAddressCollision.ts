import { PUBLIC_DIRECTORY } from './CLIENT_BUILD.ts'

/**
 * Throws, naming both, when a public file and a page claim the same address.
 *
 * 36.13 — A PUBLIC FILE AND A PAGE MAY NOT CLAIM ONE ADDRESS. The two are separate walks of two
 * separate trees, so from inside either one the collision is invisible; this is the one place
 * they meet, and naming BOTH is the clause — naming one leaves the reader to find the other.
 *
 * THE BUILD AND DEV, and `abide start` trusts the build: `answerRequest` answers a public file
 * AHEAD of any route on the ground that 36.13 makes a collision impossible at run time, and 30.8
 * says dev must resolve an address the way the built app does.
 *
 * PUBLIC ADDRESSES IN, so a caller hands whichever it already holds: the build derives one per
 * globbed name (36.11 — the path below the directory IS the address) and the dev worker's
 * `published` map is keyed by them already.
 */
export function refuseAddressCollision(
    routes: readonly { pattern: string }[],
    publicAddresses: Iterable<string>,
    command: string,
): void {
    const patterns = new Set<string>()
    for (const route of routes) patterns.add(route.pattern)
    for (const address of publicAddresses)
        if (patterns.has(address))
            throw new Error(
                `${command}: ui/${PUBLIC_DIRECTORY}${address} and the page at ${address} claim the same address. RULEBOOK 36.13.`,
            )
}
