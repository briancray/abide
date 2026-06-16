/*
Derives a deterministic localhost port from the program name so the connect
screen's origin (and thus its localStorage) stays stable across launches — a
remembered server URL survives a relaunch only if the page is reloaded from the
same origin. Hashes the name with FNV-1a (32-bit) and maps it into the
dynamic/private range (49152–65535). The caller probes availability and falls
back to a random free port on collision, so determinism is a best effort, not a
guarantee.
*/
export function stableLocalPort(programName: string): number {
    // FNV-1a 32-bit: offset basis 2166136261, prime 16777619. Math.imul keeps
    // the multiply in 32-bit space; `>>> 0` reads the result back as unsigned.
    let hash = 0x811c9dc5
    for (const character of programName) {
        hash ^= character.charCodeAt(0)
        hash = Math.imul(hash, 0x01000193)
    }
    return 49152 + ((hash >>> 0) % 16384)
}
