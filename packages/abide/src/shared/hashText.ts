// A SHORT, STABLE HASH, synchronous on both sides: `Bun.hash` is not in a browser and
// `crypto.subtle.digest` is a promise. cyrb53 — 53 bits, so a collision is no concern at the scale of
// a cookie's keys, and nothing adversarial is ever keyed by it.

/** `text` hashed to 53 bits, in base 36. */
export function hashText(text: string): string {
    let high = 0xdeadbeef
    let low = 0x41c6ce57
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index)
        high = Math.imul(high ^ code, 2654435761)
        low = Math.imul(low ^ code, 1597334677)
    }
    high =
        Math.imul(high ^ (high >>> 16), 2246822507) ^
        Math.imul(low ^ (low >>> 13), 3266489909)
    low =
        Math.imul(low ^ (low >>> 16), 2246822507) ^
        Math.imul(high ^ (high >>> 13), 3266489909)
    return (4294967296 * (2097151 & low) + (high >>> 0)).toString(36)
}
