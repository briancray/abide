// 44.52-44.55 — a pasted, dropped or picked image as a turn's piece. The drawing is the browser's, so
// `createImageBitmap` and `OffscreenCanvas` stand in here as a bitmap of a given size and a canvas
// that answers what it was asked to draw.

import { afterEach, expect, test } from 'bun:test'

import { imageFiles, imagePiece } from '#shared/imagePiece.ts'

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

// THE REVERTS: drop `Math.min(1, …)` and a small image is drawn up to 1568 rather than sent as it
// is; draw a GIF and it arrives as one frame's PNG; keep a HEIC's type and the model is handed an
// image it refuses (44.36).
test('an image is drawn down to 1568 on its long side, a photo as a JPEG — 44.52, 44.53', async () => {
    drawsAt(3136, 1000)
    const screenshot = await imagePiece(
        new Blob(['full'], { type: 'image/webp' }),
    )
    expect(screenshot.mimeType).toBe('image/png')
    expect(decoded(screenshot.data)).toBe('1568x500')
    const photo = await imagePiece(new Blob(['full'], { type: 'image/jpeg' }))
    expect(photo.mimeType).toBe('image/jpeg')
    expect(decoded(photo.data)).toBe('1568x500')
    // A GIF goes as it is, every frame of it.
    const moving = await imagePiece(new Blob(['frames'], { type: 'image/gif' }))
    expect(moving).toEqual({
        type: 'image',
        data: btoa('frames'),
        mimeType: 'image/gif',
    })

    drawsAt(800, 600)
    const small = await imagePiece(new Blob(['small'], { type: 'image/png' }))
    expect(small).toEqual({
        type: 'image',
        data: btoa('small'),
        mimeType: 'image/png',
    })
    // A type no model is shown is drawn as one, at whatever size.
    const heic = await imagePiece(new Blob(['heic'], { type: 'image/heic' }))
    expect(heic.mimeType).toBe('image/jpeg')
    expect(decoded(heic.data)).toBe('800x600')
})

// THE REVERT: send an image nothing could draw as it is, and a HEIC reaches `assistant` to be
// refused there (44.36) rather than here, where the page can say so.
test('an image nothing can draw goes as it is, or throws where a model is not shown its type — 44.54', async () => {
    drawsAt(0, 0, true)
    const png = await imagePiece(new Blob(['png'], { type: 'image/png' }))
    expect(png).toEqual({
        type: 'image',
        data: btoa('png'),
        mimeType: 'image/png',
    })
    await expect(
        imagePiece(new Blob(['heic'], { type: 'image/heic' })),
    ).rejects.toThrow('RULEBOOK 44.54')
    // Where nothing draws at all — a server — an image of a type a model is shown goes as it is.
    held.createImageBitmap = undefined
    const large = await imagePiece(new Blob(['large'], { type: 'image/jpeg' }))
    expect(large.data).toBe(btoa('large'))
})

// THE REVERT: read `files` alone, and a paste carrying its image in `items` attaches nothing.
test('a paste or a drop hands on the images a model is shown, from its items where its files hold none — 44.55', () => {
    const png = new File(['png'], 'shot.png', { type: 'image/png' })
    const svg = new File(['svg'], 'icon.svg', { type: 'image/svg+xml' })
    const jpeg = new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' })
    const dropped = { files: [svg, png, jpeg], items: [] }
    expect(imageFiles(dropped as unknown as DataTransfer)).toEqual([png, jpeg])
    const item = (file: File) => ({
        kind: 'file',
        type: file.type,
        getAsFile: () => file,
    })
    const pasted = {
        files: [],
        items: [{ kind: 'string', type: 'text/plain' }, item(svg), item(png)],
    }
    expect(imageFiles(pasted as unknown as DataTransfer)).toEqual([png])
    expect(imageFiles(null)).toEqual([])
})
