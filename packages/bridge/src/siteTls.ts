import { getCACertificates } from 'node:tls' // bun's fetch reads this machine's trust store only under `--use-system-ca`, a flag `bun x` and the link handler's launch cannot pass

/**
 * 44.47 — bun's own roots and this machine's, so a site whose certificate an organization's authority
 * signed is reached as the browser reaches it. A `ca` replaces bun's roots rather than adding to them,
 * so both are passed.
 */
export function siteTls(): { ca: string[] } {
    return {
        ca: [
            ...new Set([
                ...getCACertificates('bundled'),
                ...getCACertificates('system'),
            ]),
        ],
    }
}
