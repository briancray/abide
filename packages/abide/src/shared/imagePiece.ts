// 44.52-44.55 — AN IMAGE A VISITOR PASTES, DROPS OR PICKS, as the piece a turn carries it in. In
// the browser it is drawn down to what a model looks at, so a full-size screenshot is not sent whole
// with every turn of the transcript, and a photo is always drawn, so where it was taken does not go
// with it; where nothing can draw (a server) it goes as it is.

import type { AssistantContent } from './AssistantEvent.ts'
import { IMAGE_TYPES } from './IMAGE_TYPES.ts'

// The longest side, in pixels, a model looks at before it scales an image down itself.
const LONG_EDGE = 1568
const JPEG_QUALITY = 0.9
// A phone's photos, which a model is not shown but a browser that decodes them draws as a JPEG.
const PHOTO_TYPES = new Set(['image/heic', 'image/heif'])

/** The image files a paste or a drop carries of a type a model is shown, or a HEIC or HEIF, in order. 44.55. */
export function imageFiles(data: DataTransfer | null): File[] {
    const files: File[] = []
    if (data === null) return files
    for (const file of data.files) if (carried(file.type)) files.push(file)
    if (files.length > 0) return files
    // A pasted image some browsers carry in `items` alone.
    for (const item of data.items) {
        if (item.kind !== 'file' || !carried(item.type)) continue
        const file = item.getAsFile()
        if (file !== null) files.push(file)
    }
    return files
}

function carried(type: string): boolean {
    return IMAGE_TYPES.has(type) || PHOTO_TYPES.has(type)
}

/** `image` as a turn's image piece, drawn down to `LONG_EDGE` on its long side. 44.52, 44.53, 44.54. */
export async function imagePiece(
    image: Blob,
): Promise<Extract<AssistantContent, { type: 'image' }>> {
    const shown = IMAGE_TYPES.has(image.type)
    // A GIF may move, and drawing it keeps one frame.
    if (image.type !== 'image/gif' && typeof createImageBitmap === 'function') {
        const drawn = await drawnDown(image, shown).catch(() => undefined)
        if (drawn !== undefined)
            return {
                type: 'image',
                data: await base64Of(drawn),
                mimeType: drawn.type,
            }
    }
    if (!shown)
        throw new Error(
            `abide: an image of ${image.type || 'no type'} could not be drawn as one a model is shown, ${[...IMAGE_TYPES].join(', ')}. RULEBOOK 44.54.`,
        )
    return { type: 'image', data: await base64Of(image), mimeType: image.type }
}

/**
 * `image` drawn at most `LONG_EDGE` on its long side, or `undefined` where it is already that and of
 * a type a model is shown — save a JPEG, which is drawn at any size so its EXIF (a phone's GPS among
 * it) is left behind and its orientation applied. A photo stays a JPEG, and anything else becomes a
 * PNG, sharp text and all — but a type a model is not shown (a HEIC) is a photo.
 */
async function drawnDown(
    image: Blob,
    shown: boolean,
): Promise<Blob | undefined> {
    const bitmap = await createImageBitmap(image)
    try {
        const scale = Math.min(
            1,
            LONG_EDGE / Math.max(bitmap.width, bitmap.height),
        )
        if (scale === 1 && shown && image.type !== 'image/jpeg')
            return undefined
        const canvas = new OffscreenCanvas(
            Math.round(bitmap.width * scale),
            Math.round(bitmap.height * scale),
        )
        canvas
            .getContext('2d')
            ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const type =
            image.type === 'image/png' || image.type === 'image/webp'
                ? 'image/png'
                : 'image/jpeg'
        return await canvas.convertToBlob({ type, quality: JPEG_QUALITY })
    } finally {
        bitmap.close()
    }
}

async function base64Of(blob: Blob): Promise<string> {
    return new Uint8Array(await blob.arrayBuffer()).toBase64()
}
