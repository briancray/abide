// WHAT A COMPONENT COSTS A ROW. 32.19 and 33 put a call, an anchor pair and one accessor per prop
// between a list and its markup, and every one of those is per ROW — which is the definition of a
// hot path CLAUDE.md gives, so the three are owed a number rather than an argument.
//
// THE ARMS ARE THE SAME CARD. The component's body is byte-identical to the inline row's, so what
// separates the two is the invocation and nothing else; the hand-written arm is the one the
// server bench already measures against, so the ratios compose.
//
// SERVER ONLY, for `benchRender`'s reason: no DOM is touched, so a bun clock is a real number
// rather than a fact about happy-dom (44.18).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs' // bun has no sync mkdtemp/rm of its own
import { emitComponent, parseAbide, TypeSession } from 'abide/compiler'
import { batch, type Sample } from 'harness/report'
import { allocated, closures } from 'harness/server'
import {
    abideCardSource,
    abideComponentSource,
    abideLoopSource,
    cards,
    vanillaMarkup,
} from './renderCases.ts'

const REPO = new URL('../../../', import.meta.url).pathname
const SIZES = [10, 100, 1000]
const made: string[] = []

type Render = () => { head: string; body: string }

async function main(): Promise<void> {
    const session = await TypeSession.open(
        `${REPO}packages/abide/tsconfig.json`,
    )
    try {
        const card = await compile(session, 'Card', abideCardSource())
        console.log(
            'A COMPONENT PER ROW — against the same row written inline, and the page written by hand\n',
        )
        for (const size of SIZES) {
            const list = cards(size)
            const inline = await compile(
                session,
                'Inline',
                abideLoopSource().replace('CARDS', JSON.stringify(list)),
            )
            const nested = await compile(
                session,
                'Page',
                abideComponentSource().replace('CARDS', JSON.stringify(list)),
                { 'Card.ts': card.module },
            )

            const measured = batch({
                case: `render ${size} cards`,
                arms: {
                    vanilla: (): void => {
                        void vanillaMarkup(list)
                    },
                    inline: (): void => {
                        void inline.render().body
                    },
                    component: (): void => {
                        void nested.render().body
                    },
                },
                emulated: null,
            })
            const vanilla = measured.samples.vanilla as Sample
            const flat = measured.samples.inline as Sample
            const child = measured.samples.component as Sample
            console.log(
                `  ${String(size).padStart(4)} cards   vanilla ${µs(vanilla)}   inline ${µs(flat)} (${ratio(flat, vanilla)})   component ${µs(child)} (${ratio(child, vanilla)})`,
            )
            console.log(
                `              ${perRow(flat, size)} ns a row inline, ${perRow(child, size)} ns a row as a component — ${ratio(child, flat)} for the invocation`,
            )
            if (size === SIZES[SIZES.length - 1]) {
                bytes(inline.render().body, nested.render().body, size)
                allocations(inline.render, nested.render, size)
            }
        }
    } finally {
        session.close()
        for (const dir of made) rmSync(dir, { recursive: true, force: true })
    }
}

// 32.19's anchors, in the bytes they actually add to a document — which is the form the claim
// has to take, a marker being free to argue about and not free to send.
function bytes(flat: string, nested: string, size: number): void {
    const plain = (text: string): number => Buffer.byteLength(text)
    const zipped = (text: string): number =>
        Bun.gzipSync(new TextEncoder().encode(text)).length
    console.log(
        `\n  ANCHORS — ${((plain(nested) - plain(flat)) / size).toFixed(1)} bytes a row, ${(
            (zipped(nested) - zipped(flat)) / size
        ).toFixed(2)} gzipped`,
    )
}

// 33.4's accessor per key, in allocations. A prop is a closure the CALLER builds per row, and a
// record to hold them — so this is the number that says whether one shape per prop (33.10) is
// paid for by the list or by the author.
function allocations(flat: Render, nested: Render, size: number): void {
    const flatClosures = closures(() => {
        flat()
    })
    const nestedClosures = closures(() => {
        nested()
    })
    const flatHeap = allocated(() => {
        flat()
    }, 20)
    const nestedHeap = allocated(() => {
        nested()
    }, 20)
    console.log(
        `  CLOSURES — inline ${flatClosures.Function}, component ${nestedClosures.Function} (${(
            (nestedClosures.Function - flatClosures.Function) / size
        ).toFixed(2)} a row)`,
    )
    const objects = (heap: { perRep: Record<string, number> }): number =>
        heap.perRep.Object ?? 0
    console.log(
        `  OBJECTS — inline ${objects(flatHeap).toFixed(1)}, component ${objects(nestedHeap).toFixed(1)} a render (${(
            (objects(nestedHeap) - objects(flatHeap)) / size
        ).toFixed(2)} a row)`,
    )
}

const µs = (sample: Sample): string =>
    `${(sample.nanoseconds / 1000).toFixed(1)} µs`
const ratio = (sample: Sample, against: Sample): string =>
    `${(sample.nanoseconds / against.nanoseconds).toFixed(2)}x`
const perRow = (sample: Sample, size: number): string =>
    (sample.nanoseconds / size).toFixed(0)

async function compile(
    session: TypeSession,
    name: string,
    source: string,
    beside: Record<string, string> = {},
): Promise<{ module: string; render: Render }> {
    const file = parseAbide(source)
    const reads = await session.reads(
        `${REPO}packages/abide/tests/fixtures/typed/src/${name}.abide`,
        file,
    )
    const module = emitComponent(file, reads)
    const dir = mkdtempSync(`${REPO}.test-modules/bench-`)
    made.push(dir)
    for (const [at, text] of Object.entries(beside))
        writeFileSync(`${dir}/${at}`, text)
    writeFileSync(`${dir}/${name}.ts`, module)
    const loaded = (await import(`${dir}/${name}.ts`)) as { default: Render }
    return { module, render: loaded.default }
}

await main()
