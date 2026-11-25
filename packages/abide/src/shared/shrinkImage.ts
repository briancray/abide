// 53.87-53.89, 53.102 — A PICTURE MADE SMALL ENOUGH TO SEND: no wider or taller than `maxEdge`, and no larger
// than `maxBytes`, lowering its quality and then its size until it fits. The same call on both sides:
// `createImageBitmap` and an `OffscreenCanvas` in a browser, `Bun.Image` on a server, each turning the
// picture the way its EXIF says first.

/** How small to make it, and what to write it as. */
export type ShrinkImageOptions = {
    /** The most pixels its longer edge keeps. `1600` by default. */
    maxEdge?: number
    /** The most bytes it may take. Unbounded by default. */
    maxBytes?: number
    /** What it is written as. Its own type where that is JPEG or WebP, else JPEG, by default. */
    type?: 'image/jpeg' | 'image/webp' | 'image/png'
    /** The quality it is written at first, from `0` to `1`. `0.85` by default. */
    quality?: number
}

// The least quality `maxBytes` lowers it to before it lowers its size instead, and how much of its size
// each lowering keeps.
const FLOOR = 0.4
const SHRINK = 0.85

/** `file` no larger than `maxEdge` on its longer edge and `maxBytes` in bytes, as a `File` of the same name. */
export async function shrinkImage(
    file: Blob & { name?: string },
    options: ShrinkImageOptions = {},
): Promise<File> {
    const maxEdge = options.maxEdge ?? 1600
    const type =
        options.type ??
        (file.type === 'image/webp' || file.type === 'image/jpeg'
            ? file.type
            : 'image/jpeg')
    const picture = await decoded(file)
    let scale = Math.min(1, maxEdge / Math.max(picture.width, picture.height))
    // 53.89 — already within every bound, of the type asked for and carrying nothing but the picture:
    // handed back as it is. A file carrying metadata is written again, which leaves it behind (53.102).
    if (
        scale === 1 &&
        file.type === type &&
        (options.maxBytes === undefined || file.size <= options.maxBytes) &&
        !carriesMetadata(new Uint8Array(await file.arrayBuffer()))
    )
        return named(file, file.name, type)
    let quality = options.quality ?? 0.85
    // 53.88 — the quality lowered first, halving the distance to the floor; then the size.
    for (;;) {
        const written = await picture.encode(scale, type, quality)
        if (
            options.maxBytes === undefined ||
            written.size <= options.maxBytes ||
            type === 'image/png'
        )
            return named(written, file.name, type)
        if (quality - FLOOR > 0.05) quality = (quality + FLOOR) / 2
        else {
            quality = options.quality ?? 0.85
            scale *= SHRINK
            if (
                Math.round(Math.max(picture.width, picture.height) * scale) < 16
            )
                return named(written, file.name, type)
        }
    }
}

type Decoded = {
    width: number
    height: number
    encode(scale: number, type: string, quality: number): Promise<Blob>
}

// 53.87 — `Bun.Image` wherever Bun runs, a server or a test's emulated page, else a browser's canvas:
// an emulated page answers `createImageBitmap` and draws nothing.
async function decoded(file: Blob): Promise<Decoded> {
    if (globalThis.Bun?.Image === undefined) {
        const bitmap = await createImageBitmap(file)
        return {
            width: bitmap.width,
            height: bitmap.height,
            encode: (scale, type, quality) => {
                const width = Math.max(1, Math.round(bitmap.width * scale))
                const height = Math.max(1, Math.round(bitmap.height * scale))
                const canvas = new OffscreenCanvas(width, height)
                canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height)
                return canvas.convertToBlob({ type, quality })
            },
        }
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const { width, height } = await new Bun.Image(bytes).metadata()
    return {
        width,
        height,
        encode: async (scale, type, quality) => {
            const sized = new Bun.Image(bytes).resize(
                Math.max(1, Math.round(width * scale)),
                Math.max(1, Math.round(height * scale)),
                { fit: 'inside' },
            )
            const level = Math.round(quality * 100)
            const written =
                type === 'image/webp'
                    ? sized.webp({ quality: level })
                    : type === 'image/png'
                      ? sized.png()
                      : sized.jpeg({ quality: level })
            return written.blob()
        },
    }
}

// What a picture carries beside its pixels that can say where, when and by whom it was taken: JPEG's
// APP1 (EXIF, XMP), APP13 (IPTC) and comment segments, WebP's `EXIF` and `XMP ` chunks, and PNG's
// `eXIf` and text chunks.
const JPEG_METADATA = new Set([0xe1, 0xed, 0xfe])
const WEBP_METADATA = new Set(['EXIF', 'XMP '])
const PNG_METADATA = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt'])

/** Whether the JPEG, WebP or PNG in `bytes` carries any of the metadata above, read from its headers. */
function carriesMetadata(bytes: Uint8Array): boolean {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const tag = (at: number) =>
        String.fromCharCode(
            bytes[at] ?? 0,
            bytes[at + 1] ?? 0,
            bytes[at + 2] ?? 0,
            bytes[at + 3] ?? 0,
        )
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
        let at = 2
        while (at + 4 <= bytes.length && bytes[at] === 0xff) {
            const marker = bytes[at + 1] ?? 0
            // Fill bytes before a marker.
            if (marker === 0xff) {
                at += 1
                continue
            }
            // The scan starts: no segment after it is a header.
            if (marker === 0xda || marker === 0xd9) return false
            if (JPEG_METADATA.has(marker)) return true
            at += 2 + view.getUint16(at + 2)
        }
        return false
    }
    if (tag(0) === 'RIFF' && tag(8) === 'WEBP') {
        for (let at = 12; at + 8 <= bytes.length;) {
            if (WEBP_METADATA.has(tag(at))) return true
            const size = view.getUint32(at + 4, true)
            at += 8 + size + (size % 2)
        }
        return false
    }
    if (bytes[0] === 0x89 && tag(1) === 'PNG') {
        for (let at = 8; at + 8 <= bytes.length;) {
            const type = tag(at + 4)
            if (PNG_METADATA.has(type)) return true
            if (type === 'IEND') return false
            at += 12 + view.getUint32(at)
        }
        return false
    }
    // A type it cannot read the headers of is taken to carry some.
    return true
}

/** `blob` as a `File` named for `name`, its extension the one `type` takes. */
function named(blob: Blob, name: string | undefined, type: string): File {
    const extension =
        type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'
    const base = (name ?? 'image').replace(/\.[^./]+$/, '')
    return new File([blob], `${base}.${extension}`, { type })
}
