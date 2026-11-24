// 44.52-44.55 — WHAT A VISITOR WRITES AND ATTACHES, as the user turn a transcript carries it in, each
// file as the Messages API's block for it. An image is drawn down to what a model looks at in the
// browser, so a full-size screenshot is not sent whole with every turn of the transcript, and a photo
// is always drawn, so where it was taken does not go with it; where nothing can draw (a server) it
// goes as it is.

import type { AssistantContent } from './AssistantEvent.ts'
import { IMAGE_TYPES } from './IMAGE_TYPES.ts'

// The longest side, in pixels, a model looks at before it scales an image down itself.
const LONG_EDGE = 1568
const JPEG_QUALITY = 0.9
// A phone's photos, which a model is not shown but a browser that decodes them draws as a JPEG.
const PHOTO_TYPES = ['image/heic', 'image/heif']
const PHOTO_EXTENSIONS = ['.heic', '.heif']
// 44.55 — a file read as its words: a type a browser names as text, JSON, or an extension a browser
// often leaves untyped.
const TEXT_TYPES = ['application/json']
const TEXT_EXTENSIONS = ['.csv', '.json', '.md', '.txt']

/**
 * Every file `userMessage` carries, as an `<input accept>` writes it: what `chat`'s composer takes.
 * 44.55.
 */
export const ATTACHABLE = [
    ...IMAGE_TYPES,
    ...PHOTO_TYPES,
    ...PHOTO_EXTENSIONS,
    'application/pdf',
    '.pdf',
    'text/*',
    ...TEXT_TYPES,
    ...TEXT_EXTENSIONS,
].join(',')

type Image = Extract<AssistantContent, { type: 'image' }>
type Shown = Image['source']['media_type']

/**
 * The user turn of `text` and `files`: each file as its block, in order, and then the words where they
 * hold any. 44.52-44.55.
 *
 * @param text what was written
 * @param files what was attached: an image, a PDF, or a file of text
 */
export async function userMessage(
    text: string,
    files: readonly Blob[] = [],
): Promise<{ role: 'user'; content: AssistantContent[] }> {
    const content: AssistantContent[] = []
    for (const file of files) content.push(await blockOf(file))
    if (/\S/.test(text)) content.push({ type: 'text', text })
    return { role: 'user', content }
}

async function blockOf(file: Blob): Promise<AssistantContent> {
    const name = (file as Partial<File>).name ?? ''
    const type = file.type.toLowerCase()
    const extension = extensionOf(name)
    if (type.startsWith('image/') || PHOTO_EXTENSIONS.includes(extension))
        return imageOf(file, type)
    const title = name === '' ? {} : { title: name }
    if (type === 'application/pdf' || extension === '.pdf')
        return {
            type: 'document',
            source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: await base64Of(file),
            },
            ...title,
        }
    if (
        type.startsWith('text/') ||
        TEXT_TYPES.includes(type) ||
        type.endsWith('+json') ||
        TEXT_EXTENSIONS.includes(extension)
    )
        return {
            type: 'document',
            source: {
                type: 'text',
                media_type: 'text/plain',
                data: await file.text(),
            },
            ...title,
        }
    throw new Error(
        `abide: ${name || 'a file'} of ${type || 'no type'} is none a model reads — an image, a PDF or text. RULEBOOK 44.55.`,
    )
}

function extensionOf(name: string): string {
    const dot = name.lastIndexOf('.')
    return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

/** `image` as its block, drawn down to `LONG_EDGE` on its long side. 44.52, 44.53, 44.54. */
async function imageOf(image: Blob, type: string): Promise<Image> {
    const shown = IMAGE_TYPES.has(type)
    // A GIF may move, and drawing it keeps one frame.
    if (type !== 'image/gif' && typeof createImageBitmap === 'function') {
        const drawn = await drawnDown(image, type, shown).catch(() => undefined)
        if (drawn !== undefined)
            return imageBlock(drawn.type as Shown, await base64Of(drawn))
    }
    if (!shown)
        throw new Error(
            `abide: an image of ${type || 'no type'} could not be drawn as one a model is shown, ${[...IMAGE_TYPES].join(', ')}. RULEBOOK 44.54.`,
        )
    return imageBlock(type as Shown, await base64Of(image))
}

function imageBlock(mediaType: Shown, data: string): Image {
    return {
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data },
    }
}

/**
 * `image` drawn at most `LONG_EDGE` on its long side, or `undefined` where it is already that and of
 * a type a model is shown — save a JPEG, which is drawn at any size so its EXIF (a phone's GPS among
 * it) is left behind and its orientation applied. A photo stays a JPEG, and anything else becomes a
 * PNG, sharp text and all — but a type a model is not shown (a HEIC) is a photo.
 */
async function drawnDown(
    image: Blob,
    type: string,
    shown: boolean,
): Promise<Blob | undefined> {
    const bitmap = await createImageBitmap(image)
    try {
        const scale = Math.min(
            1,
            LONG_EDGE / Math.max(bitmap.width, bitmap.height),
        )
        if (scale === 1 && shown && type !== 'image/jpeg') return undefined
        const canvas = new OffscreenCanvas(
            Math.round(bitmap.width * scale),
            Math.round(bitmap.height * scale),
        )
        canvas
            .getContext('2d')
            ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const drawnAs =
            type === 'image/png' || type === 'image/webp'
                ? 'image/png'
                : 'image/jpeg'
        return await canvas.convertToBlob({
            type: drawnAs,
            quality: JPEG_QUALITY,
        })
    } finally {
        bitmap.close()
    }
}

async function base64Of(blob: Blob): Promise<string> {
    return new Uint8Array(await blob.arrayBuffer()).toBase64()
}
