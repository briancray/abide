export function randomToken(
    bytes: number,
    encoding: 'base64' | 'base64url' | 'hex',
): string {
    return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString(
        encoding,
    )
}
