/*
Mints a random lowercase-hex id of `bytes` length via the web-standard
crypto.getRandomValues — trace ids (16 bytes) and span ids (8 bytes). Loops on
the all-zero value, which W3C Trace Context reserves as invalid.
*/
export function randomHexId(bytes: number): string {
    const buffer = new Uint8Array(bytes)
    let id = ''
    do {
        crypto.getRandomValues(buffer)
        id = Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('')
    } while (/^0+$/.test(id))
    return id
}
