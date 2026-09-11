// THE LIVE PASS, taken over every example card in the built docs and collected into
// one table. It drives the same panel a reader drives — the same injectable, the same
// bridge, the same message — rather than a second path that could agree with nothing.
//
// It is the slow half of `bun run status` — every card reloads its frame with the
// instrument in, waits for the DOM to go quiet, and prices its op if it names one —
// so it reports each card as it lands rather than returning a table at the end.

import { chromium, type Locator, type Page } from '@playwright/test'

const REPO = new URL('../../../', import.meta.url).pathname
const DIST = `${REPO}packages/dogfood/dist`

type Reading = {
    op: string
    substrate: string
    loadedArm: string
    load: Record<string, number | null>
    arms: Record<string, { nanosecondsPerOp: number; p95: number }>
    timing: { n: number; reps: number; floor: number } | null
    paint: { firstContentfulPaint: number | null; firstPaint: number | null }
    size: { nodes: number }
}

const COUNTS: [label: string, key: string][] = [
    ['moved', 'elementsMoved'],
    ['created', 'nodesCreated'],
    ['class', 'classWrites'],
    ['style', 'styleWrites'],
    ['data', 'dataWrites'],
]

export type CardReading = {
    example: string
    counts: string
    nodes: number | null
    firstPaintMilliseconds: number | null
    nanosecondsPerOp: number | null
    sample: string | null
    refused: string | null
}

export async function readExampleReadings(
    // Called as each card lands, so a pass that takes minutes fills a table rather
    // than producing one at the end.
    onCard?: (card: CardReading, done: number, total: number) => void,
): Promise<CardReading[]> {
    if (!(await Bun.file(`${DIST}/index.html`).exists()))
        throw new Error('the docs are not built — run `bun run docs` first')

    const server = Bun.serve({
        port: 0,
        async fetch(request) {
            const path = new URL(request.url).pathname
            const file = Bun.file(
                DIST + (path.endsWith('/') ? `${path}index.html` : path),
            )
            return (await file.exists())
                ? new Response(file)
                : new Response('404', { status: 404 })
        },
    })

    const pages: string[] = []
    for (const path of new Bun.Glob('**/*.html').scanSync({ cwd: DIST }))
        if (path !== 'status.html') pages.push(path)
    pages.sort()

    const browser = await chromium.launch()
    const cards: CardReading[] = []
    let total = 0
    try {
        const page = await browser.newPage()
        for (const path of pages) {
            await page.goto(`http://localhost:${server.port}/${path}`)
            total += await page.locator('.example').count()
        }
        for (const path of pages) {
            await page.goto(`http://localhost:${server.port}/${path}`)
            const count = await page.locator('.example').count()
            for (let index = 0; index < count; index += 1) {
                const card = page.locator('.example').nth(index)
                const example = (
                    await card.locator('.ex-title').innerText()
                ).trim()
                const reading = await readOneCard(page, card)
                const landed = shapeCard(example, reading)
                cards.push(landed)
                onCard?.(landed, cards.length, total)
            }
        }
    } finally {
        await browser.close()
        server.stop(true)
    }
    return cards
}

async function readOneCard(
    page: Page,
    card: Locator,
): Promise<{ reading: Reading | null; refused: string }> {
    try {
        await card.getByRole('tab', { name: 'Bench' }).click()
        // Collected off the frame's own message rather than scraped back out of the
        // rendered table: the table is a rendering of this, and reading the
        // rendering would price the renderer.
        const waiting = page.evaluate(
            () =>
                new Promise<unknown>((resolve) => {
                    addEventListener('message', function once(event) {
                        const data = event.data as {
                            abideReading?: unknown
                            abideRefused?: unknown
                        }
                        if (!data?.abideReading && !data?.abideRefused) return
                        removeEventListener('message', once)
                        resolve(data)
                    })
                }),
        )
        await card
            .getByRole('button', { name: /Measure in this browser/ })
            .click()
        const answer = (await Promise.race([
            waiting,
            Bun.sleep(90_000).then(() => null),
        ])) as { abideReading?: Reading; abideRefused?: string } | null
        if (!answer) return { reading: null, refused: 'timed out' }
        if (answer.abideRefused)
            return { reading: null, refused: answer.abideRefused }
        return { reading: answer.abideReading ?? null, refused: 'no reading' }
    } catch (error) {
        return {
            reading: null,
            refused: error instanceof Error ? error.message : String(error),
        }
    }
}

function shapeCard(
    example: string,
    answer: { reading: Reading | null; refused: string },
): CardReading {
    const reading = answer.reading
    if (!reading)
        return {
            example,
            counts: '',
            nodes: null,
            firstPaintMilliseconds: null,
            nanosecondsPerOp: null,
            sample: null,
            refused: answer.refused,
        }
    const arm = reading.arms['hand-written']
    return {
        example,
        counts: COUNTS.map(([label, key]) => {
            const value = reading.load[key]
            return value ? `${value} ${label}` : ''
        })
            .filter(Boolean)
            .join(', '),
        nodes: reading.size.nodes,
        firstPaintMilliseconds:
            reading.paint.firstContentfulPaint ?? reading.paint.firstPaint,
        nanosecondsPerOp: arm ? arm.nanosecondsPerOp : null,
        sample: reading.timing
            ? `n=${reading.timing.n} ±${(reading.timing.floor * 100).toFixed(1)}%`
            : null,
        refused: null,
    }
}
