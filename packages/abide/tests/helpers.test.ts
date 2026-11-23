// 52.110, 52.111 and 53.79-53.83 — `highlight`, `shrinkImage` on a server's `Bun.Image` (a browser's
// canvas is the e2e's), and `download` with the link it clicks caught here.

import { afterEach, expect, spyOn, test } from 'bun:test'

import { download, highlight, shrinkImage } from '#shared'

const ICON = new URL('../../dogfood/src/public/icon.png', import.meta.url)
const marked = (runs: ReturnType<typeof highlight>) =>
    runs
        .map((run) => (run.match === undefined ? run.text : `[${run.text}]`))
        .join('')

// THE REVERT: hand `labelRuns` no needles, and nothing in the text is marked.
test('highlight marks the first stretch holding the query, or each word of it — 52.110', () => {
    expect(marked(highlight('Engine renewal', 'REN'))).toBe('Engine [ren]ewal')
    expect(
        marked(highlight('Engine renewal', 'renewal engine', { words: true })),
    ).toBe('[Engine] [renewal]')
    expect(highlight('Engine', 'gin')[1]?.match).toEqual({
        'data-highlight': 'match',
    })
})

test('a blank query marks nothing — 52.111', () => {
    expect(highlight('Engine renewal', '  ')).toEqual([
        { text: 'Engine renewal', match: undefined },
    ])
})

const icon = async () =>
    new File([await Bun.file(ICON).bytes()], 'icon.png', { type: 'image/png' })
const edges = async (file: Blob) =>
    new Bun.Image(new Uint8Array(await file.arrayBuffer())).metadata()

// THE REVERT: write it at its own size, and a 1024px icon stays 1024px.
test('a picture is made no larger than maxEdge, as JPEG where its own type is neither — 53.79', async () => {
    const small = await shrinkImage(await icon(), { maxEdge: 64 })
    expect([small.name, small.type]).toEqual(['icon.jpg', 'image/jpeg'])
    expect(await edges(small)).toMatchObject({
        width: 64,
        height: 64,
        format: 'jpeg',
    })
})

// THE REVERT: write it once at its quality, and a byte budget below that is overrun.
test('a picture over maxBytes is lowered in quality, then in size, until it fits — 53.80', async () => {
    const roomy = await shrinkImage(await icon(), {
        maxEdge: 512,
        quality: 0.95,
    })
    const budget = Math.floor(roomy.size / 4)
    const tight = await shrinkImage(await icon(), {
        maxEdge: 512,
        maxBytes: budget,
        quality: 0.95,
    })
    expect(tight.size).toBeLessThanOrEqual(budget)
})

// THE REVERT: write every picture again, and one already small enough comes back changed.
test('a picture already within every bound is handed back as it is — 53.81', async () => {
    const written = await shrinkImage(await icon(), {
        maxEdge: 128,
        type: 'image/webp',
    })
    const again = await shrinkImage(written, { maxEdge: 128 })
    expect(again.size).toBe(written.size)
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(
        new Uint8Array(await written.arrayBuffer()),
    )
})

afterEach(() => document.body.replaceChildren())

// THE REVERT: drop the `download` attribute from the link, and the browser opens the file rather than
// saving it.
test('download saves text or bytes under a name, through a link clicked — 53.82', () => {
    const clicked: { href: string; download: string }[] = []
    const click = spyOn(
        HTMLAnchorElement.prototype,
        'click',
    ).mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push({ href: this.href, download: this.download })
    })
    download('name,amount\nEngine renewal,12000', 'deals.csv', 'text/csv')
    click.mockRestore()
    expect(clicked).toHaveLength(1)
    expect(clicked[0]?.download).toBe('deals.csv')
    expect(clicked[0]?.href.startsWith('blob:')).toBe(true)
})
