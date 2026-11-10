const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * The width and height a PNG's header declares, or `undefined` where `bytes` is no PNG — or one cut
 * off before its header's width and height.
 */
export function pngSize(
    bytes: Uint8Array,
): { width: number; height: number } | undefined {
    if (bytes.length < 24) return undefined
    for (let at = 0; at < SIGNATURE.length; at += 1)
        if (bytes[at] !== SIGNATURE[at]) return undefined
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { width: view.getUint32(16), height: view.getUint32(20) }
}
