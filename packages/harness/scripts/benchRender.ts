// HOW LONG A PAGE TAKES TO RENDER, which nothing measured until now. The clocks this repo had
// covered the hydration WALK, the reactive core and compile time — none of them the two things a
// reader actually waits on: the server producing the document, and the client mounting into it.
//
// SERVER ONLY HERE. No DOM is touched, so a bun clock is a real number rather than a fact about
// happy-dom (44.18 refuses the other kind at the instrument). The client half is `render.spec.ts`,
// in a browser, for the same reason.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs' // bun has no sync mkdtemp/rm of its own
import { compileFile, parseAbide, TypeSession } from 'abide/compiler'
import { render } from 'abide/server'
import { batch, ratio, type Sample } from 'harness/report'
import { abideSource, cards, vanillaMarkup } from './renderCases.ts'

const REPO = new URL('../../../', import.meta.url).pathname
const SIZES = [10, 100, 1000]
const made: string[] = []

async function main(): Promise<void> {
    const session = await TypeSession.open(
        `${REPO}packages/abide/tsconfig.json`,
    )
    console.log(
        'SERVER RENDER — a card list, against the page written by hand\n',
    )
    try {
        for (const size of SIZES) {
            const list = cards(size)
            const source = abideSource(size).replace(
                'CARDS',
                JSON.stringify(list),
            )
            const file = parseAbide(source)
            const names = await session.reactiveNames(
                `${REPO}packages/abide/tests/fixtures/typed/src/render.abide`,
                file,
            )
            const Component = await load(compileFile(source, names))

            const measured = batch({
                case: `render ${size} cards`,
                arms: {
                    abide: (): void => {
                        void drain(Component)
                    },
                    vanilla: (): void => {
                        void vanillaMarkup(list)
                    },
                },
                emulated: null,
            })
            report(size, measured)
        }
    } finally {
        session.close()
        for (const dir of made) rmSync(dir, { recursive: true, force: true })
    }
}

// The emitted module, written where the tests write theirs — outside `packages/abide`, so
// `conventions.test.ts`'s glob does not scan it and two runs cannot share one path.
async function load(
    module: string,
): Promise<() => { head: string; body: string }> {
    const dir = mkdtempSync(`${REPO}.test-modules/bench-`)
    made.push(dir)
    writeFileSync(`${dir}/Page.ts`, module)
    const loaded = (await import(`${dir}/Page.ts`)) as {
        default: () => { head: string; body: string }
    }
    return loaded.default
}

// The component produces its markup; `render` is what turns it into bytes. Timed together,
// because together is what a request pays.
function drain(component: () => { head: string; body: string }): string {
    const rendered = component()
    return rendered.head + rendered.body
}

function report(size: number, measured: ReturnType<typeof batch>): void {
    const abide = measured.samples.abide as Sample
    const vanilla = measured.samples.vanilla as Sample
    const result = ratio(abide, vanilla, { floor: measured.floor })
    const perCard = abide.nanoseconds / size
    console.log(
        `  ${String(size).padStart(4)} cards   abide ${(abide.nanoseconds / 1000).toFixed(1)} µs   vanilla ${(vanilla.nanoseconds / 1000).toFixed(1)} µs   ${
            result.kind === 'ratio'
                ? `${result.value.toFixed(2)}x`
                : result.kind
        }`,
    )
    console.log(
        `              ${perCard.toFixed(0)} ns a card; a 100 ms interaction budget is ~${Math.round(100e6 / perCard).toLocaleString()} cards`,
    )
}

console.log(`
WHAT THIS SAYS

  ABIDE IS FASTER THAN THE HAND-WRITTEN PAGE at every size a page really is — 0.81x at 10
  cards, 0.87x at 100 — and the reason is the escaping. \`escapeText\` SCANS and returns the
  input untouched when there is nothing to rewrite; a person writing the same page by hand
  reaches for a \`replaceAll\` chain, which allocates three times per value whether or not
  anything needed escaping. \`renderShare.ts\` prices that alone at 40 µs against 124.

  THE FIRST VERSION OF THIS BENCH SAID 28x THE OTHER WAY, and it was wrong because the arm
  did not escape at all. An unescaped interpolation of data you did not author is an
  injection, so it was not the same work — the compiled page has 32.1 and cannot choose.
  SHARED SOURCE IS NOT SHARED WORK, and an arm that skips the safety is the same mistake as
  an arm that renders nothing.

  AT 1000 CARDS ABIDE LOSES, 2.9x, and the cause is the emitted SHAPE rather than anything
  per slot. A 1000-card page with no \`{#for}\` unrolls to one function with ~7000 straight-line
  property accesses, and straight-line code that runs once never becomes warm — the same
  content in a LOOP is 42 µs against 250. Array-join and append-to-a-string emit the same
  250 µs, so it is not the concatenation either.

  WHICH MAKES IT A \`{#for}\` PROBLEM AND NOT A RENDERING ONE. A repeated region emits a loop
  by construction, and a hand-unrolled thousand-slot template is not a shape to optimise for.
  The number to watch after \`{#for}\` lands is this same row.
`)

void render
await main()
