// networkAddress() — this machine's LAN IPv4, for the `network` row of a serve banner, or undefined
// when there is no external interface (a container with only loopback, an offline laptop).
//
// `node:os` rather than a Bun API because Bun exposes no interface enumeration — one of the
// "unless necessary" cases. Cheap and synchronous, and it runs once per boot, not per request.
//
// This is only truthful because the router calls `Bun.serve` with no `hostname`, which binds
// 0.0.0.0 — every interface. If that ever narrows to loopback, this row starts advertising an
// address nothing answers on.

import { networkInterfaces } from 'node:os'

export function networkAddress(): string | undefined {
    for (const entries of Object.values(networkInterfaces())) {
        if (entries === undefined) continue
        for (const entry of entries) {
            if (entry.internal) continue
            // `family` is the string 'IPv4' under Bun and current Node, and was the NUMBER 4 in
            // Node 18.0–18.3. Both are accepted rather than picked, because getting it wrong drops
            // the row silently — there is no error, just a banner that never mentions the network.
            if (entry.family === 'IPv4' || (entry.family as unknown as number) === 4)
                return entry.address
        }
    }
    return undefined
}
