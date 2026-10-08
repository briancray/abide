// WHAT A COMPONENT COSTS A ROW. 32.17 and 33 put a call, an anchor pair and one accessor per prop
// between a list and its markup, and every one of those is per ROW — which is the definition of a
// hot path CLAUDE.md gives, so the three are owed a number rather than an argument.
//
// THE ARMS ARE THE SAME CARD. The component's body is byte-identical to the inline row's, so what
// separates the two is the invocation and nothing else; the hand-written arm is the one the
// server bench already measures against, so the ratios compose.
//
// SERVER ONLY, for `benchRender`'s reason: no DOM is touched, so a bun clock is a real number
// rather than a fact about happy-dom (44.18).

import { batch, emulatedDom, type Sample } from 'harness/report'
import { allocated, closures } from 'harness/server'
import { openBenchCompiler, type Render } from './openBenchCompiler.ts'
import {
    abideCardSource,
    abideComponentSource,
    abideDeclaredSource,
    abideLoopSource,
    cards,
    vanillaMarkup,
} from './renderCases.ts'

const SIZES = [10, 100, 1000]

async function main(): Promise<void> {
    const { compile, close } = await openBenchCompiler()
    try {
        const card = await compile('Card', abideCardSource())
        console.log(
            'A COMPONENT PER ROW — against the same row written inline, and the page written by hand\n',
        )
        for (const size of SIZES) {
            const list = cards(size)
            const inline = await compile(
                'Inline',
                abideLoopSource().replace('CARDS', JSON.stringify(list)),
            )
            const nested = await compile(
                'Page',
                abideComponentSource().replace('CARDS', JSON.stringify(list)),
                { 'Card.ts': card.module },
            )
            // 32.42 — AN INLINE COMPONENT IN THE ROW, declared alone and then invoked: a function
            // declared per row, closing over it.
            const declared = await compile(
                'Declared',
                abideDeclaredSource(false).replace(
                    'CARDS',
                    JSON.stringify(list),
                ),
            )
            const invoked = await compile(
                'Invoked',
                abideDeclaredSource(true).replace(
                    'CARDS',
                    JSON.stringify(list),
                ),
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
                    declared: (): void => {
                        void declared.render().body
                    },
                    invoked: (): void => {
                        void invoked.render().body
                    },
                },
                emulated: emulatedDom(),
            })
            const vanilla = measured.samples.vanilla as Sample
            const flat = measured.samples.inline as Sample
            const child = measured.samples.component as Sample
            const alone = measured.samples.declared as Sample
            const called = measured.samples.invoked as Sample
            console.log(
                `  ${String(size).padStart(4)} cards   vanilla ${µs(vanilla)}   inline ${µs(flat)} (${times(flat, vanilla)})   component ${µs(child)} (${times(child, vanilla)})`,
            )
            console.log(
                `              ${perRow(flat, size)} ns a row inline, ${perRow(child, size)} ns a row as a component — ${times(child, flat)} for the invocation`,
            )
            console.log(
                `              inline component: ${perRow(alone, size)} ns a row declared alone (${times(alone, flat)}), ${perRow(called, size)} ns a row invoked (${times(called, flat)})`,
            )
            if (size === SIZES[SIZES.length - 1]) {
                bytes(inline.render().body, nested.render().body, size)
                allocations(inline.render, nested.render, size)
            }
        }
    } finally {
        close()
    }
}

/**
 * Prints the bytes a row's component anchors add, raw and gzipped.
 *
 * 32.17's anchors, in the bytes they actually add to a document — which is the form the claim has
 * to take, a marker being free to argue about and not free to send.
 */
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

/**
 * Prints the closures and objects a component row allocates over the same row inline.
 *
 * 33.4's accessor per key, in allocations. A prop is a closure the CALLER builds per row, and a
 * record to hold them — so this is the number that says whether one shape per prop (33.10) is paid
 * for by the list or by the author.
 */
function allocations(flat: Render, nested: Render, size: number): void {
    // `closures` and `allocated` both take a `() => unknown`, which a `Render` already is — a
    // wrapper here would only put another frame inside the body being measured.
    const flatClosures = closures(flat).Function
    const nestedClosures = closures(nested).Function
    const flatObjects = allocated(flat, 20).perRep.Object ?? 0
    const nestedObjects = allocated(nested, 20).perRep.Object ?? 0
    console.log(
        `  CLOSURES — inline ${flatClosures}, component ${nestedClosures} (${(
            (nestedClosures - flatClosures) / size
        ).toFixed(2)} a row)`,
    )
    console.log(
        `  OBJECTS — inline ${flatObjects.toFixed(1)}, component ${nestedObjects.toFixed(1)} a render (${(
            (nestedObjects - flatObjects) / size
        ).toFixed(2)} a row)`,
    )
}

const µs = (sample: Sample): string =>
    `${(sample.nanoseconds / 1000).toFixed(1)} µs`
/**
 * One sample's time over another's, as `1.23x`.
 *
 * NOT `harness/report`'s `ratio`, deliberately, and the name says so. That one refuses any sample
 * `batch()` took unbatched and under a frame — which is click -> paint being frame quantised, and
 * is every size above 10 cards here. This lane is a bun clock over a string render with nothing
 * waiting on a frame, so the refusal does not apply and the division is the honest report.
 */
const times = (sample: Sample, against: Sample): string =>
    `${(sample.nanoseconds / against.nanoseconds).toFixed(2)}x`
const perRow = (sample: Sample, size: number): string =>
    (sample.nanoseconds / size).toFixed(0)

await main()
