// HOW LONG A PAGE TAKES TO RENDER, which nothing measured until now. The clocks this repo had
// covered the hydration WALK, the reactive core and compile time — none of them the two things a
// reader actually waits on: the server producing the document, and the client mounting into it.
//
// SERVER ONLY HERE. No DOM is touched, so a bun clock is a real number rather than a fact about
// happy-dom (43.18 refuses the other kind at the instrument). The client half is `render.spec.ts`,
// in a browser, for the same reason.

import {
    batch,
    claimOf,
    emulatedDom,
    type Ratio,
    ratio,
    type Sample,
} from '@abide/harness/report'

import { openBenchCompiler, type Render } from './openBenchCompiler.ts'
import {
    abideLoopSource,
    abideSource,
    cards,
    vanillaCarefulMarkup,
    vanillaMarkup,
} from './renderCases.ts'

const SIZES = [10, 100, 1000]

type Verdicts = {
    size: number
    // `{#for}` over each hand-written page, and the unrolled page over `{#for}`.
    obvious: Ratio
    careful: Ratio
    unrolled: Ratio
}

async function main(): Promise<void> {
    const { compile, close } = await openBenchCompiler()
    console.log(
        'SERVER RENDER — a card list, against the page written by hand two ways\n',
    )
    const verdicts: Verdicts[] = []
    try {
        for (const size of SIZES) {
            const list = cards(size)
            const Component = (
                await compile(
                    'Unrolled',
                    abideSource(size).replace('CARDS', JSON.stringify(list)),
                )
            ).render
            const Loop = (
                await compile(
                    'Loop',
                    abideLoopSource().replace('CARDS', JSON.stringify(list)),
                )
            ).render

            const measured = batch({
                case: `render ${size} cards`,
                arms: {
                    vanilla: (): void => {
                        void vanillaMarkup(list)
                    },
                    'vanilla, careful': (): void => {
                        void vanillaCarefulMarkup(list)
                    },
                    'abide, {#for}': (): void => {
                        void drain(Loop)
                    },
                    'abide, unrolled': (): void => {
                        void drain(Component)
                    },
                },
                emulated: emulatedDom(),
            })
            verdicts.push(report(size, measured))
        }
    } finally {
        close()
    }
    summarize(verdicts)
}

/**
 * Renders a compiled component and returns its head and body as one string.
 *
 * The component produces its markup; `render` is what turns it into bytes. Timed together, because
 * together is what a request pays.
 */
function drain(component: Render): string {
    const rendered = component()
    return rendered.head + rendered.body
}

const µs = (sample: Sample): string =>
    `${(sample.nanoseconds / 1000).toFixed(1)} µs`

function report(size: number, measured: ReturnType<typeof batch>): Verdicts {
    const vanilla = measured.samples.vanilla as Sample
    const careful = measured.samples['vanilla, careful'] as Sample
    const loop = measured.samples['abide, {#for}'] as Sample
    const unrolled = measured.samples['abide, unrolled'] as Sample
    const floor = { floor: measured.floor }
    const verdicts = {
        size,
        obvious: ratio(loop, vanilla, floor),
        careful: ratio(loop, careful, floor),
        unrolled: ratio(unrolled, loop, floor),
    }
    console.log(
        `  ${String(size).padStart(4)} cards   A/A floor ${(measured.floor * 100).toFixed(1)}%   n=${measured.n}`,
    )
    console.log(
        `              vanilla ${µs(vanilla)}   careful ${µs(careful)}   {#for} ${µs(loop)} (${claimOf(verdicts.obvious)} vanilla, ${claimOf(verdicts.careful)} careful)   unrolled ${µs(unrolled)}`,
    )
    console.log(
        `              ${(loop.nanoseconds / size).toFixed(0)} ns a card through the loop; unrolled is ${claimOf(verdicts.unrolled)} of it`,
    )
    return verdicts
}

/** Which way a verdict points, or `level` when the floor cannot tell. */
function sideOf(result: Ratio): 'faster' | 'slower' | 'level' {
    if (result.kind !== 'ratio') return 'level'
    return result.value < 1 ? 'faster' : 'slower'
}

/**
 * What THIS run says, derived from its verdicts: a conclusion typed into the source goes on
 * printing beside runs that measured the opposite.
 */
function summarize(verdicts: Verdicts[]): void {
    console.log('\nWHAT THIS RUN SAYS\n')
    for (const verdict of verdicts) {
        const obvious = sideOf(verdict.obvious)
        const careful = sideOf(verdict.careful)
        const escaping =
            obvious === 'faster' && careful !== 'faster'
                ? ' — the win is the escaping: a hand arm that tests before rewriting takes it back'
                : ''
        const loop = sideOf(verdict.unrolled)
        console.log(
            `  ${String(verdict.size).padStart(4)} cards: {#for} is ${obvious === 'level' ? 'level with' : `${obvious} than`} the obvious page and ${careful === 'level' ? 'level with' : `${careful} than`} the careful one${escaping}; unrolled is ${loop === 'level' ? 'level with' : `${loop} than`} the loop`,
        )
    }
    console.log(`
  ONE RUN. This bench has swung 1.2x-1.8x across runs of identical code, wider than the A/A floor
  one run measures — take five and read the spread before quoting any ratio above.

  THE HAND ARMS ESCAPE, and they have to. The first version of this bench did not, and read 28x
  the other way: an unescaped interpolation of data you did not author is an injection, and the
  compiled page has 32.1 and cannot choose. SHARED SOURCE IS NOT SHARED WORK. The obvious arm
  escapes with a \`replaceAll\` chain that allocates three times per value; the careful arm tests
  first, the way \`escapeText\` scans first, so what separates abide from it is not the escaping.

  THE UNROLLED COLUMN IS WHY \`{#for}\` EXISTS: a page written without it compiles to one function
  of straight-line property accesses, and straight-line code that runs once never becomes warm.
`)
}

await main()
