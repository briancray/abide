// 53.79-53.81 — A PICTURE MADE SMALL ENOUGH TO SEND: no wider or taller than `maxEdge`, and no larger
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
    // 53.81 — already within every bound and of the type asked for: handed back as it is.
    if (
        scale === 1 &&
        file.type === type &&
        (options.maxBytes === undefined || file.size <= options.maxBytes)
    )
        return named(file, file.name, type)
    let quality = options.quality ?? 0.85
    // 53.80 — the quality lowered first, halving the distance to the floor; then the size.
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

// 53.79 — `Bun.Image` wherever Bun runs, a server or a test's emulated page, else a browser's canvas:
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

/** `blob` as a `File` named for `name`, its extension the one `type` takes. */
function named(blob: Blob, name: string | undefined, type: string): File {
    const extension =
        type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'
    const base = (name ?? 'image').replace(/\.[^./]+$/, '')
    return new File([blob], `${base}.${extension}`, { type })
}
