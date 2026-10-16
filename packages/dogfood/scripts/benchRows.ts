// EVERY BENCH WITH A HAND-WRITTEN ARM, AS ROWS — what the docs app's bench page lists and runs.
// A row is abide against vanilla in one substrate, and the ratio is the claim (CLAUDE.md,
// "performance and measurement"); a bench with no vanilla arm — the grid's bytes, the shares, the
// browser specs — is not a row here and keeps its own script.
//
// SERIAL, ALWAYS. Two timings sharing a machine are contention, so this runs one row at a time
// and a run is one process, never a pool.
//
// `bun packages/dogfood/scripts/benchRows.ts --list`, or `--scope section:Reactive --filter fan`,
// from the repo root.

import { TypeSession } from '@abide/abide/compiler'
import {
    type Batched,
    batch,
    claimOf,
    emulatedDom,
    type Ratio,
    ratio,
    type Sample,
} from '@abide/harness/report'
import type { BenchRow, RowItem } from '@abide/harness/rows'
import { rowsCommand } from '@abide/harness/runner'
import { openBenchCompiler } from '../../abide/bench/openBenchCompiler.ts'
import { reactiveCases } from '../../abide/bench/reactiveCases.ts'
import { reactiveCoreLines } from '../../abide/bench/reactiveCoreLines.ts'
import {
    abideCardSource,
    abideComponentSource,
    abideLoopSource,
    cards,
    vanillaMarkup,
} from '../../abide/bench/renderCases.ts'
import { type Arm, armNames, armOf } from './benchCompiler.ts'
import { DOGFOOD } from './exampleSources.ts'

type Measured = Pick<
    BenchRow,
    'unit' | 'subject' | 'handWritten' | 'claim' | 'n' | 'floor' | 'note'
>

// What more than one row needs and is expensive to make: a checker session is seconds to open.
type Context = {
    compiler: ReturnType<typeof openBenchCompiler> | undefined
    session: Promise<TypeSession> | undefined
    arms: Map<string, Promise<Arm | null>>
}

// A row that counts rather than times has no batch and no A/A floor.
const UNTIMED = { n: null, floor: null }

type BenchItem = RowItem & { measure: (context: Context) => Promise<Measured> }

const SIZES = [10, 100, 1000]

function compilerOf(context: Context): ReturnType<typeof openBenchCompiler> {
    context.compiler ??= openBenchCompiler()
    return context.compiler
}

/** `abide / vanilla` as a two-decimal `x` string — for COUNTS, which have no clock and no floor. */
function divided(abide: number, vanilla: number): string {
    return `${(abide / vanilla).toFixed(2)}x`
}

/**
 * A timed row's claim.
 *
 * Inside the A/A floor the arms are indistinguishable, and the floor has a column of its own to
 * say how wide that is.
 */
function claimed(result: Ratio): string {
    return result.kind === 'underTheFloor' ? '1.00x' : claimOf(result)
}

function timed(
    measured: Batched,
    abideArm: string,
    unitDivisor: number,
    unit: string,
): Measured {
    const abide = measured.samples[abideArm] as Sample
    const vanilla = measured.samples.vanilla as Sample
    return {
        unit,
        subject: abide.nanoseconds / unitDivisor,
        handWritten: vanilla.nanoseconds / unitDivisor,
        claim: claimed(ratio(abide, vanilla, { floor: measured.floor })),
        n: measured.n,
        floor: measured.floor,
        note: '',
    }
}

function reactiveItems(): BenchItem[] {
    const items: BenchItem[] = []
    for (const kase of reactiveCases())
        items.push({
            id: `reactive/${kase.name}`,
            section: 'Reactive core',
            name: kase.name,
            measure: async () => {
                const measured = batch({
                    case: kase.name,
                    arms: { vanilla: kase.vanilla, abide: kase.abide },
                    emulated: emulatedDom(),
                })
                const counted = kase.work()
                const abide = {
                    ...(measured.samples.abide as Sample),
                    work: counted.abide,
                }
                const vanilla = {
                    ...(measured.samples.vanilla as Sample),
                    work: counted.vanilla,
                }
                const result = ratio(abide, vanilla, { floor: measured.floor })
                return {
                    unit: 'ns',
                    subject: abide.nanoseconds,
                    handWritten: vanilla.nanoseconds,
                    claim: claimed(result),
                    n: measured.n,
                    floor: measured.floor,
                    // WORK FIRST: a ratio over two arms doing different jobs prices two jobs.
                    note:
                        result.workDisagreement.length > 0
                            ? `work disagrees — ${result.workDisagreement.join('; ')}`
                            : '',
                }
            },
        })
    return items
}

function renderItems(): BenchItem[] {
    const items: BenchItem[] = []
    for (const size of SIZES)
        items.push({
            id: `render/${size}`,
            section: 'Server render',
            name: `render ${size} cards, {#for}`,
            measure: async (context) => {
                const list = cards(size)
                const { compile } = await compilerOf(context)
                const loop = await compile(
                    'Loop',
                    abideLoopSource().replace('CARDS', JSON.stringify(list)),
                )
                const measured = batch({
                    case: `render ${size} cards`,
                    arms: {
                        vanilla: (): void => {
                            void vanillaMarkup(list)
                        },
                        abide: (): void => {
                            const rendered = loop.render()
                            void (rendered.head + rendered.body)
                        },
                    },
                    emulated: emulatedDom(),
                })
                return timed(measured, 'abide', 1000, 'µs')
            },
        })
    for (const size of SIZES)
        items.push({
            id: `component/${size}`,
            section: 'Component per row',
            name: `render ${size} cards, one component each`,
            measure: async (context) => {
                const list = cards(size)
                const { compile } = await compilerOf(context)
                const card = await compile('Card', abideCardSource())
                const page = await compile(
                    'Page',
                    abideComponentSource().replace(
                        'CARDS',
                        JSON.stringify(list),
                    ),
                    { 'Card.ts': card.module },
                )
                const measured = batch({
                    case: `render ${size} cards`,
                    arms: {
                        vanilla: (): void => {
                            void vanillaMarkup(list)
                        },
                        abide: (): void => {
                            void page.render().body
                        },
                    },
                    emulated: emulatedDom(),
                })
                return timed(measured, 'abide', 1000, 'µs')
            },
        })
    return items
}

/**
 * The paired docs examples as rows, authored and shipped lines against the hand-written arm.
 *
 * The two budgets `bench:compiler` reports: what an author writes and what a browser downloads,
 * each in code lines against the hand-written arm.
 */
function compilerItems(): BenchItem[] {
    const items: BenchItem[] = []
    const armOfName = (context: Context, name: string) => {
        let arm = context.arms.get(name)
        if (arm === undefined) {
            context.session ??= TypeSession.open(
                new URL('tsconfig.json', DOGFOOD).pathname,
            )
            arm = context.session.then((session) => armOf(session, name))
            context.arms.set(name, arm)
        }
        return arm
    }
    for (const name of armNames()) {
        items.push({
            id: `compiler/${name}/authored`,
            section: 'Compiler',
            name: `${name} — authored`,
            measure: async (context) => {
                const arm = await armOfName(context, name)
                if (arm === null)
                    return {
                        unit: 'lines',
                        subject: null,
                        handWritten: null,
                        claim: 'no vanilla script',
                        ...UNTIMED,
                        note: '',
                    }
                return {
                    unit: 'lines',
                    subject: arm.authoredAbide,
                    handWritten: arm.authoredVanilla,
                    claim: divided(arm.authoredAbide, arm.authoredVanilla),
                    ...UNTIMED,
                    note: 'what a developer writes',
                }
            },
        })
        items.push({
            id: `compiler/${name}/shipped`,
            section: 'Compiler',
            name: `${name} — shipped`,
            measure: async (context) => {
                const arm = await armOfName(context, name)
                if (arm === null || !arm.typeable)
                    return {
                        unit: 'lines',
                        subject: null,
                        handWritten: arm?.shippedVanilla ?? null,
                        claim:
                            arm === null
                                ? 'no vanilla script'
                                : 'not typeable yet',
                        ...UNTIMED,
                        note: '',
                    }
                return {
                    unit: 'lines',
                    subject: arm.shippedAbide,
                    handWritten: arm.shippedVanilla,
                    claim: divided(arm.shippedAbide, arm.shippedVanilla),
                    ...UNTIMED,
                    note: 'emitted client module; the runtime is charged to every page besides',
                }
            },
        })
    }
    return items
}

// EVERY DOCS CARD THAT PRICES ITSELF: a `tests/*.bench.ts` beside a page exports `priced()`, its
// arms named `abide` and `handWritten`, so the number the card's page points at is a row here
// rather than a figure in its prose.
function docsItems(): BenchItem[] {
    const items: BenchItem[] = []
    for (const path of new Bun.Glob('src/**/tests/*.bench.ts').scanSync({
        cwd: DOGFOOD.pathname,
    })) {
        const page = path.slice('src/'.length, path.indexOf('/tests/'))
        items.push({
            id: `docs/${page}`,
            section: 'Docs examples',
            name: page,
            measure: async () => {
                const { priced } = (await import(
                    new URL(path, DOGFOOD).href
                )) as { priced: () => Batched }
                const measured = priced()
                const abide = measured.samples.abide as Sample
                const handWritten = measured.samples.handWritten as Sample
                return {
                    unit: 'ns',
                    subject: abide.nanoseconds,
                    handWritten: handWritten.nanoseconds,
                    claim: claimed(
                        ratio(abide, handWritten, { floor: measured.floor }),
                    ),
                    n: measured.n,
                    floor: measured.floor,
                    note: `the card on /${page}`,
                }
            },
        })
    }
    return items
}

function machineryItems(): BenchItem[] {
    return [
        {
            id: 'machinery/reactive-core',
            section: 'Machinery',
            name: 'reactive core, code lines',
            measure: async () => {
                const { abide, vanilla } = await reactiveCoreLines()
                return {
                    unit: 'lines',
                    subject: abide,
                    handWritten: vanilla,
                    claim: divided(abide, vanilla),
                    ...UNTIMED,
                    note: 'against the hand-written signal',
                }
            },
        },
    ]
}

if (import.meta.main)
    await rowsCommand<BenchItem, BenchRow>(
        [
            ...reactiveItems(),
            ...renderItems(),
            ...compilerItems(),
            ...docsItems(),
            ...machineryItems(),
        ],
        async (selected, emit) => {
            const empty = {
                unit: '',
                subject: null,
                handWritten: null,
                claim: '',
                ...UNTIMED,
                note: '',
            }
            for (const item of selected)
                emit({ id: item.id, state: 'queued', ...empty })
            const context: Context = {
                compiler: undefined,
                session: undefined,
                arms: new Map(),
            }
            try {
                for (const item of selected) {
                    emit({ id: item.id, state: 'running', ...empty })
                    try {
                        emit({
                            id: item.id,
                            state: 'done',
                            ...(await item.measure(context)),
                        })
                    } catch (error) {
                        emit({
                            id: item.id,
                            state: 'broken',
                            ...empty,
                            note:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        })
                    }
                }
            } finally {
                // A compiler that failed to open already broke every row that needed it.
                ;(await context.compiler?.catch(() => undefined))?.close()
                ;(await context.session?.catch(() => undefined))?.close()
            }
        },
    )
