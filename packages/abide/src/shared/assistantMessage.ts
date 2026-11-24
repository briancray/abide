// 44.52-44.55, 44.105 — A MESSAGE OF A CONVERSATION, as the Messages API holds it: one written — what
// a visitor writes and attaches, each file as the API's block for it — or the ones an answer's events
// amount to. An image is drawn down to what a model looks at in the browser, so a full-size
// screenshot is not sent whole with every turn, and a photo is always drawn, so where it was taken
// does not go with it; where nothing can draw (a server) it goes as it is.

import type {
    AssistantContent,
    AssistantEvent,
    AssistantMessage,
} from './AssistantEvent.ts'
import { IMAGE_TYPES } from './IMAGE_TYPES.ts'
import { MessageAccumulator } from './MessageAccumulator.ts'

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
 * Every file `assistantMessage` carries, as an `<input accept>` writes it: what `chat`'s composer takes.
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
type Shown = Extract<Image['source'], { type: 'base64' }>['media_type']

// 44.55 — what a URL's path names, which the API fetches itself.
const URL_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp']

// The events only a stream carries, which no block shares a type with — and the two abide adds.
const EVENT_TYPES = new Set([
    'message_start',
    'content_block_start',
    'content_block_delta',
    'content_block_stop',
    'message_delta',
    'message_stop',
    'ping',
    'tool_result',
    'permission',
])

/**
 * The messages an answer's events amount to, accumulated as the Messages API's clients accumulate its
 * stream: each run an assistant message, each tool result in the user message after it, a call that
 * never answered left out. 44.105.
 *
 * @param role `'assistant'`: events are what the model said
 * @param events an answer's events, as `assistant` streamed them
 */
export function assistantMessage(
    role: 'assistant',
    events: readonly AssistantEvent[],
): AssistantMessage[]
/**
 * A turn of `parts` in order: words as a text block where they hold any, each file as its block, a
 * URL as the block the API fetches it into, and a block as it is written — so
 * `['Compare', receipt, 'with', invoice]` reads as written. 44.52-44.55.
 *
 * @param role who says it: the person asking, or the assistant, as when a conversation is seeded
 * @param parts what was written and attached: words, images, PDFs or files of text, URLs of an image
 * or a PDF, and blocks built by hand — a file only in the person's turn (44.37)
 */
export function assistantMessage(
    role: AssistantMessage['role'],
    parts: readonly (string | Blob | URL | AssistantContent)[],
): Promise<AssistantMessage & { content: AssistantContent[] }>
export function assistantMessage(
    role: AssistantMessage['role'],
    parts: readonly (string | Blob | URL | AssistantContent | AssistantEvent)[],
):
    | AssistantMessage[]
    | Promise<AssistantMessage & { content: AssistantContent[] }> {
    if (role === 'assistant' && isEvents(parts)) {
        const messages: AssistantMessage[] = []
        const accumulator = new MessageAccumulator(0)
        for (const event of parts) accumulator.add(messages, event)
        accumulator.settle(messages)
        return messages
    }
    return turnOf(
        role,
        parts as readonly (string | Blob | URL | AssistantContent)[],
    )
}

/**
 * Whether `parts` is an answer's events: every one an event no block shares a type with — none at all
 * included, an answer not yet begun, as the events overload types an empty list.
 */
function isEvents(
    parts: readonly (string | Blob | URL | AssistantContent | AssistantEvent)[],
): parts is readonly AssistantEvent[] {
    for (const part of parts)
        if (
            typeof part !== 'object' ||
            part instanceof Blob ||
            part instanceof URL ||
            !EVENT_TYPES.has(part.type)
        )
            return false
    return true
}

async function turnOf(
    role: AssistantMessage['role'],
    parts: readonly (string | Blob | URL | AssistantContent)[],
): Promise<AssistantMessage & { content: AssistantContent[] }> {
    const content: AssistantContent[] = []
    for (const part of parts)
        if (typeof part === 'string') {
            if (/\S/.test(part)) content.push({ type: 'text', text: part })
        } else if (part instanceof Blob) {
            // 44.37 — an attachment is the asker's to show, never a turn the model answered.
            if (role !== 'user')
                throw new Error(
                    `abide: ${(part as Partial<File>).name || 'a file'} was attached to an assistant turn, and a file stands only in the person's. RULEBOOK 44.37.`,
                )
            content.push(await blockOf(part))
        } else if (part instanceof URL) content.push(urlBlockOf(part))
        else content.push(part)
    return { role, content }
}

function urlBlockOf(url: URL): AssistantContent {
    const extension = extensionOf(url.pathname)
    if (extension === '.pdf')
        return { type: 'document', source: { type: 'url', url: url.href } }
    if (URL_IMAGE_EXTENSIONS.includes(extension))
        return { type: 'image', source: { type: 'url', url: url.href } }
    throw new Error(
        `abide: ${url.href} names neither an image nor a PDF by its path, and a model is handed only those by URL. RULEBOOK 44.55.`,
    )
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
