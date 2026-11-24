// 44.52-44.55 — what a visitor writes and attaches as a user turn, each file as its block. The drawing
// is the browser's, so `createImageBitmap` and `OffscreenCanvas` stand in here as a bitmap of a given
// size and a canvas that answers what it was asked to draw.

import { afterEach, expect, test } from 'bun:test'

import type { AssistantContent } from '#shared/AssistantEvent.ts'
import { userMessage } from '#shared/userMessage.ts'

const held = globalThis as unknown as Record<string, unknown>
const BEFORE = {
    createImageBitmap: held.createImageBitmap,
    OffscreenCanvas: held.OffscreenCanvas,
}

afterEach(() => {
    held.createImageBitmap = BEFORE.createImageBitmap
    held.OffscreenCanvas = BEFORE.OffscreenCanvas
})

/** A browser whose bitmaps are `width` by `height`, or that decodes nothing where `undecodable`. */
function drawsAt(width: number, height: number, undecodable = false): void {
    held.createImageBitmap = async () => {
        if (undecodable)
            throw new Error('The source image could not be decoded.')
        return { width, height, close() {} }
    }
    held.OffscreenCanvas = class {
        width: number
        height: number
        constructor(width: number, height: number) {
            this.width = width
            this.height = height
        }
        getContext() {
            return { drawImage() {} }
        }
        async convertToBlob({ type }: { type: string }) {
            return new Blob([`${this.width}x${this.height}`], { type })
        }
    }
}

const decoded = (data: string): string => atob(data)

type Image = Extract<AssistantContent, { type: 'image' }>

/** `file` as the one block `userMessage` makes of it. */
async function blockOf(file: Blob): Promise<AssistantContent> {
    const { content } = await userMessage([file])
    expect(content).toHaveLength(1)
    return content[0] as AssistantContent
}

const imageOf = async (file: Blob) => ((await blockOf(file)) as Image).source

const imageBlock = (
    media_type: Image['source']['media_type'],
    data: string,
): Image => ({ type: 'image', source: { type: 'base64', media_type, data } })

// THE REVERTS: drop `Math.min(1, …)` and a small image is drawn up to 1568 rather than sent as it
// is; draw a GIF and it arrives as one frame's PNG; keep a HEIC's type and the model is handed an
// image it refuses (44.36); send a small JPEG as it is and its EXIF — the phone's GPS — goes with it.
test('an image is drawn down to 1568 on its long side, a photo as a JPEG — 44.52, 44.53', async () => {
    drawsAt(3136, 1000)
    const screenshot = await imageOf(new Blob(['full'], { type: 'image/webp' }))
    expect(screenshot.media_type).toBe('image/png')
    expect(decoded(screenshot.data)).toBe('1568x500')
    const photo = await imageOf(new Blob(['full'], { type: 'image/jpeg' }))
    expect(photo.media_type).toBe('image/jpeg')
    expect(decoded(photo.data)).toBe('1568x500')
    // A GIF goes as it is, every frame of it.
    expect(await blockOf(new Blob(['frames'], { type: 'image/gif' }))).toEqual(
        imageBlock('image/gif', btoa('frames')),
    )

    drawsAt(800, 600)
    expect(await blockOf(new Blob(['small'], { type: 'image/png' }))).toEqual(
        imageBlock('image/png', btoa('small')),
    )
    // A photo is drawn at its own size, so its metadata is left behind.
    const snapshot = await imageOf(new Blob(['exif'], { type: 'image/jpeg' }))
    expect(snapshot.media_type).toBe('image/jpeg')
    expect(decoded(snapshot.data)).toBe('800x600')
    // A type no model is shown is drawn as one, at whatever size — and an untyped `.heic` is one.
    const heic = await imageOf(new Blob(['heic'], { type: 'image/heic' }))
    expect(heic.media_type).toBe('image/jpeg')
    expect(decoded(heic.data)).toBe('800x600')
    const untyped = await imageOf(new File(['heic'], 'IMG_0001.HEIC'))
    expect(untyped.media_type).toBe('image/jpeg')
})

// THE REVERT: send an image nothing could draw as it is, and a HEIC reaches `assistant` to be
// refused there (44.36) rather than here, where the page can say so.
test('an image nothing can draw goes as it is, or throws where a model is not shown its type — 44.54', async () => {
    drawsAt(0, 0, true)
    expect(await blockOf(new Blob(['png'], { type: 'image/png' }))).toEqual(
        imageBlock('image/png', btoa('png')),
    )
    await expect(
        userMessage([new Blob(['heic'], { type: 'image/heic' })]),
    ).rejects.toThrow('RULEBOOK 44.54')
    // Where nothing draws at all — a server — an image of a type a model is shown goes as it is.
    held.createImageBitmap = undefined
    const large = await imageOf(new Blob(['large'], { type: 'image/jpeg' }))
    expect(large.data).toBe(btoa('large'))
})

// THE REVERTS: read a PDF as text, and the model is handed its bytes as words — a `text` source
// where `base64` is due; read a file of text by its type alone, and an untyped `.csv` throws rather
// than being read.
test('a PDF is a document, and a file of text a text document, each titled with its name — 44.55', async () => {
    held.createImageBitmap = undefined
    const statement = new File(['%PDF'], 'statement.pdf', {
        type: 'application/pdf',
    })
    const trades = new File(['symbol,qty\nVOO,7'], 'trades.csv')
    const notes = new File(['{"goal":"retire"}'], 'notes.json', {
        type: 'application/json',
    })
    expect(
        await userMessage([statement, trades, notes, 'What did I hold?']),
    ).toEqual({
        role: 'user',
        content: [
            {
                type: 'document',
                source: {
                    type: 'base64',
                    media_type: 'application/pdf',
                    data: btoa('%PDF'),
                },
                title: 'statement.pdf',
            },
            {
                type: 'document',
                source: {
                    type: 'text',
                    media_type: 'text/plain',
                    data: 'symbol,qty\nVOO,7',
                },
                title: 'trades.csv',
            },
            {
                type: 'document',
                source: {
                    type: 'text',
                    media_type: 'text/plain',
                    data: '{"goal":"retire"}',
                },
                title: 'notes.json',
            },
            { type: 'text', text: 'What did I hold?' },
        ],
    })
    // A Blob with no name is a document with no title.
    expect(
        await blockOf(new Blob(['plain words'], { type: 'text/plain' })),
    ).toEqual({
        type: 'document',
        source: { type: 'text', media_type: 'text/plain', data: 'plain words' },
    })
})

// THE REVERT: push every file ahead of the words, and the turn reads `image,image,text,text` where
// the words and receipts are written `text,image,text,image`.
test('words and files are blocks in the order given — 44.55', async () => {
    held.createImageBitmap = undefined
    const receipt = new Blob(['png'], { type: 'image/png' })
    const invoice = new Blob(['gif'], { type: 'image/gif' })
    const { content } = await userMessage([
        'Compare this receipt',
        receipt,
        'with this one',
        invoice,
    ])
    expect(content.map((block) => block.type).join()).toBe(
        'text,image,text,image',
    )
})

// THE REVERT: push the words whatever they hold, and an empty question sends a text block the API
// refuses — two blocks where one is due.
test('words of whitespace alone are left out, and a file no model reads throws naming it — 44.55', async () => {
    held.createImageBitmap = undefined
    const shot = new Blob(['png'], { type: 'image/png' })
    expect((await userMessage(['  \n ', shot])).content).toHaveLength(1)
    expect(await userMessage(['Hello'])).toEqual({
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
    })
    await expect(
        userMessage([
            new File(['zip'], 'archive.zip', { type: 'application/zip' }),
        ]),
    ).rejects.toThrow('archive.zip')
})
