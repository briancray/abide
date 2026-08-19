// This machine's LAN IPv4, for the `network` row of a serve banner — or `undefined` when there is no
// external interface at all, which is a container with only loopback and an offline laptop.
//
// `node:os` stands in for a Bun api that does not exist: nothing on `Bun` enumerates interfaces. It
// is synchronous and it runs once per boot rather than per request, so the cost is a line of the
// banner rather than anything a served page pays.
//
// The row is only TRUE because the socket is bound with no `hostname` — `Bun.serve` then takes
// 0.0.0.0, every interface. A bind that ever narrows to loopback makes this an address printed for a
// port nothing answers on, which is worse than no row.
import { networkInterfaces } from 'node:os'

export function networkAddress(): string | undefined {
    for (const entries of Object.values(networkInterfaces())) {
        if (entries === undefined) continue
        for (const entry of entries) {
            // Loopback is the row above this one, and it is already printed by name.
            if (entry.internal) continue
            if (entry.family === 'IPv4') return entry.address
        }
    }
    return undefined
}
