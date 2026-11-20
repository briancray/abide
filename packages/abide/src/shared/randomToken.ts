/** `bytes` random bytes, encoded as `encoding` — base64url unpadded, as a URL or a cookie carries it. */
export function randomToken(
    bytes: number,
    encoding: 'base64' | 'base64url' | 'hex',
): string {
    const random = crypto.getRandomValues(new Uint8Array(bytes))
    return encoding === 'hex'
        ? random.toHex()
        : random.toBase64({
              alphabet: encoding,
              omitPadding: encoding === 'base64url',
          })
}
