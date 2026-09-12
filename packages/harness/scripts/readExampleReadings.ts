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

// The shape the frame posts back, which is `harness/measure`'s own `Reading`. It is
// declared rather than imported: this script drives a BROWSER and reads a message off
// a page, so what arrives is JSON with no type behind it, and a declaration here is
// the honest spelling of "this is what we expect to find".
type Reading = {
    op: string
    substrate: string
    agent: string
    loadedArm: string
    load: Record<string, number | null>
    arms: Record<
        string,
        {
            work: Record<string, number | null>
            nanosecondsPerOp: number
            p95: number
        }
    >
    ratios: Record<
        string,
        { kind: string; value?: number; floor?: number; numerator: string }
    >
    timing: { n: number; reps: number; floor: number } | null
    paint: {
        firstContentfulPaint: number | null
        firstPaint: number | null
        longTasks: number
    }
    size: { nodes: number; scriptBytes: number }
    clockNanoseconds: number
}

// THE ARM EVERY RATIO IS AGAINST, named once. `harness/measure/vanilla` is what a
// card's hand-written arm runs, and the panel labels it with this string.
export const HAND_WRITTEN = 'hand-written'
export const ABIDE_ARM = 'abide'

export type ArmRow = {
    arm: string
    nanosecondsPerOp: number
    p95: number
    work: Record<string, number | null>
}

// WIDENED FROM FIVE FLATTENED FIELDS. The first shape kept one arm's ns/op and joined
// the load counters into a display string, which meant the abide arm, every per-arm
// work counter, the ratio and the paint timeline were all discarded at the point they
// were read — so a table wanting any of them had to re-drive the browser. A reading
// is cheap to carry and expensive to take.
export type CardReading = {
    example: string
    // The docs page the card is on, so a row can be followed back to what it teaches.
    page: string
    // The op the timing half priced. `'load'` where the card named nothing repeatable.
    op: string
    substrate: string
    agent: string
    arms: ArmRow[]
    // Against the hand-written arm, as `ratio()` decided it — a value, or one of its
    // refusals (`underOneFrame`, `underTheFloor`), or absent where only one arm ran.
    ratio: { kind: string; value: number | null; floor: number | null } | null
    // What the PAGE cost, apart from what the op cost.
    load: Record<string, number | null>
    paint: {
        firstPaint: number | null
        firstContentfulPaint: number | null
        longTasks: number
    }
    size: { nodes: number; scriptBytes: number }
    timing: { n: number; reps: number; floor: number } | null
    clockNanoseconds: number | null
    refused: string | null
}

export async function readExampleReadings(
    // Called as each card lands, so a pass that takes minutes fills a table rather
    // than producing one at the end.
    onCard?: (card: CardReading, done: number, total: number) => void,
    // Asked BETWEEN cards. A pass over 69 cards is minutes long and the reader who
    // started it may not want to wait; stopping between two is clean, where killing
    // the browser mid-card leaves a page open and a fixture half measured.
    shouldStop?: () => boolean,
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
            if (shouldStop?.()) break
            await page.goto(`http://localhost:${server.port}/${path}`)
            const count = await page.locator('.example').count()
            for (let index = 0; index < count; index += 1) {
                if (shouldStop?.()) break
                const card = page.locator('.example').nth(index)
                const example = (
                    await card.locator('.ex-title').innerText()
                ).trim()
                const reading = await readOneCard(page, card)
                const landed = shapeCard(example, path, reading)
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
    page: string,
    answer: { reading: Reading | null; refused: string },
): CardReading {
    const reading = answer.reading
    if (!reading)
        return {
            example,
            page,
            op: '',
            substrate: '',
            agent: '',
            arms: [],
            ratio: null,
            load: {},
            paint: {
                firstPaint: null,
                firstContentfulPaint: null,
                longTasks: 0,
            },
            size: { nodes: 0, scriptBytes: 0 },
            timing: null,
            clockNanoseconds: null,
            refused: answer.refused,
        }
    const arms: ArmRow[] = []
    for (const arm of Object.keys(reading.arms)) {
        const one = reading.arms[arm]
        if (one === undefined) continue
        arms.push({
            arm,
            nanosecondsPerOp: one.nanosecondsPerOp,
            p95: one.p95,
            work: one.work ?? {},
        })
    }
    // The one ratio the bench table is about: what the abide arm cost against the arm
    // it has to beat. Absent where only one arm ran, which is not the same as 1.
    const against =
        reading.ratios[ABIDE_ARM] ?? Object.values(reading.ratios)[0]
    return {
        example,
        page,
        op: reading.op,
        substrate: reading.substrate,
        agent: reading.agent,
        arms,
        ratio: against
            ? {
                  kind: against.kind,
                  value: against.value ?? null,
                  floor: against.floor ?? null,
              }
            : null,
        load: reading.load,
        paint: {
            firstPaint: reading.paint.firstPaint,
            firstContentfulPaint: reading.paint.firstContentfulPaint,
            longTasks: reading.paint.longTasks ?? 0,
        },
        size: reading.size,
        timing: reading.timing,
        clockNanoseconds: reading.clockNanoseconds ?? null,
        refused: null,
    }
}
