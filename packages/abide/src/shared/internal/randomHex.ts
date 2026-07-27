// `bytes` cryptographically-random bytes as lower-case hex. Shared by the two W3C Trace Context id
// mints (`generateTraceparent`, `outgoingTraceparent`) so a trace id and a span id are produced the
// same way — both fields are opaque random identifiers, and the only difference is their width.

export function randomHex(bytes: number): string {
    const buffer = new Uint8Array(bytes)
    crypto.getRandomValues(buffer)
    let out = ''
    for (const byte of buffer) {
        out += byte.toString(16).padStart(2, '0')
    }
    return out
}
