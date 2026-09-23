import { PUBLIC_DIRECTORY } from './CLIENT_BUILD.ts'

// 36.13 — A PUBLIC FILE AND A PAGE MAY NOT CLAIM ONE ADDRESS. The two are separate walks of two
// separate trees, so from inside either one the collision is invisible; this is the one place
// they meet, and naming BOTH is the clause — naming one leaves the reader to find the other.
//
// EVERY COMMAND THAT SERVES, not the one that builds. This lived inside `abide build`'s copy
// loop, which meant `abide dev` checked nothing — and `answerRequest` answers a public file
// AHEAD of any route on the stated ground that 36.13 makes a collision impossible at run time.
// That premise was false in exactly the lane 30.8 says must resolve an address the way the
// built app does, so dev silently preferred the file and the page was unreachable.
//
// ADDRESSES IN, so a caller hands whichever it already holds: the build derives one per globbed
// name (36.11 — the path below the directory IS the address) and the dev worker's `published`
// map is keyed by them already.
export function refuseAddressCollision(
    routePatterns: Iterable<string>,
    publicAddresses: Iterable<string>,
    command: string,
): void {
    const addresses = new Set(routePatterns)
    for (const address of publicAddresses)
        if (addresses.has(address))
            throw new Error(
                `${command}: ui/${PUBLIC_DIRECTORY}${address} and the page at ${address} claim the same address. RULEBOOK 36.13.`,
            )
}
