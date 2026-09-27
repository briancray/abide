// EVERY BENCH WITH A HAND-WRITTEN ARM, AS ROWS — what the docs app's bench page lists and runs.
// A row is abide against vanilla in one substrate, and the ratio is the claim (CLAUDE.md,
// "performance and measurement"); a bench with no vanilla arm — the grid's bytes, the shares, the
// browser specs — is not a row here and keeps its own script.
//
// SERIAL, ALWAYS. Two timings sharing a machine are contention, so this runs one row at a time
// and a run is one process, never a pool.
//
// `bun packages/harness/scripts/benchRows.ts --list`, or `--scope section:Reactive --filter fan`,
// from the repo root.

import { TypeSession } from 'abide/compiler'
import {
    type Batched,
    batch,
    claimOf,
    ratio,
    type Sample,
} from 'harness/report'
import { type Arm, armNames, armOf } from './benchCompiler.ts'
import { DOGFOOD } from './exampleSources.ts'
import { openBenchCompiler } from './openBenchCompiler.ts'
import { reactiveCases } from './reactiveCases.ts'
import { reactiveCoreLines } from './reactiveCoreLines.ts'
import {
    abideCardSource,
    abideComponentSource,
    abideLoopSource,
    cards,
    vanillaMarkup,
} from './renderCases.ts'
import { rowsCommand } from './rowsCommand.ts'
import type { BenchRow, RowItem } from './rows.ts'

type Measured = Pick<BenchRow, 'unit' | 'abide' | 'vanilla' | 'claim' | 'note'>

// What more than one row needs and is expensive to make: a checker session is seconds to open.
type Context = {
    compiler: ReturnType<typeof openBenchCompiler> | undefined
    session: Promise<TypeSession> | undefined
    arms: Map<string, Promise<Arm | null>>
}

type BenchItem = RowItem & { measure: (context: Context) => Promise<Measured> }

const SIZES = [10, 100, 1000]

function compilerOf(context: Context): ReturnType<typeof openBenchCompiler> {
    context.compiler ??= openBenchCompiler()
    return context.compiler
}

// NOT `ratio()` for the render lanes, for `benchComponent`'s reason: it refuses a sample under a
// frame, and a string render on a bun clock has no frame waiting on it.
function divided(abide: number, vanilla: number): string {
    return `${(abide / vanilla).toFixed(2)}x`
}

function timed(
    measured: Batched,
    abideArm: string,
    unitDivisor: number,
    unit: string,
): Measured {
    const abide = (measured.samples[abideArm] as Sample).nanoseconds
    const vanilla = (measured.samples.vanilla as Sample).nanoseconds
    return {
        unit,
        abide: abide / unitDivisor,
        vanilla: vanilla / unitDivisor,
        claim: divided(abide, vanilla),
        note: `n=${measured.n} · A/A floor ${(measured.floor * 100).toFixed(1)}%`,
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
                    emulated: null,
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
                    abide: abide.nanoseconds,
                    vanilla: vanilla.nanoseconds,
                    claim: claimOf(result),
                    // WORK FIRST: a ratio over two arms doing different jobs prices two jobs.
                    note:
                        result.workDisagreement.length > 0
                            ? `work disagrees — ${result.workDisagreement.join('; ')}`
                            : `n=${measured.n} · A/A floor ${(measured.floor * 100).toFixed(1)}%`,
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
                    emulated: null,
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
                    emulated: null,
                })
                return timed(measured, 'abide', 1000, 'µs')
            },
        })
    return items
}

// The paired docs examples, in the two budgets `bench:compiler` reports: what an author writes and
// what a browser downloads, each in code lines against the hand-written arm.
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
                        abide: null,
                        vanilla: null,
                        claim: 'no vanilla script',
                        note: '',
                    }
                return {
                    unit: 'lines',
                    abide: arm.authoredAbide,
                    vanilla: arm.authoredVanilla,
                    claim: divided(arm.authoredAbide, arm.authoredVanilla),
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
                        abide: null,
                        vanilla: arm?.shippedVanilla ?? null,
                        claim:
                            arm === null
                                ? 'no vanilla script'
                                : 'not typeable yet',
                        note: '',
                    }
                return {
                    unit: 'lines',
                    abide: arm.shippedAbide,
                    vanilla: arm.shippedVanilla,
                    claim: divided(arm.shippedAbide, arm.shippedVanilla),
                    note: 'emitted client module; the runtime is charged to every page besides',
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
                    abide,
                    vanilla,
                    claim: divided(abide, vanilla),
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
            ...machineryItems(),
        ],
        async (selected, emit) => {
            const empty = {
                unit: '',
                abide: null,
                vanilla: null,
                claim: '',
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
