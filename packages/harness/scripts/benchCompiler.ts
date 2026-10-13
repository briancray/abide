// WHAT THE COMPILER COSTS AND WHAT IT BUYS, against the arm somebody would have written by hand.
//
// The arms are not invented here. Every docs example is a `.abide` component, and
// `packages/harness/arms/<example>` is a hand-written page doing the same job, written as a pair —
// and those are the only honest arms available: an arm written beside the implementation it
// flatters gets MORE scrutiny, not less, and these predate the compiler entirely.
//
// TWO BUDGETS, because they run in opposite directions and reporting one alone is how a trade
// gets hidden:
//   AUTHORED  — what a developer writes. Lower is the claim.
//   SHIPPED   — what the browser downloads: emitted client module plus the runtime in its static
//               closure. Higher is the price, and the runtime is charged to EVERY page.
//
// COMPILE TIME HAS NO RATIO AND IS NOT GIVEN ONE. There is no hand-written arm for "run
// the compiler", so it is reported as an absolute ceiling with the machine and the date on it —
// a budget, never a claim.

import {
    componentGraph,
    emitClient,
    emitComponent,
    parseAbide,
    TypeSession,
} from '@abide/abide/compiler'
import { codeLinesOf, countLines } from './countLines.ts'
import { abideSourcesOf, DOGFOOD } from './exampleSources.ts'

const ARMS = new URL('../arms/', import.meta.url)
const REPO = new URL('../../../', import.meta.url)

// Enough rounds that one slow scheduling hiccup cannot carry the average.
const ROUNDS = 10
const SCRIPT_TAG_LINE = /^[ \t]*<script\b[^>]*\bsrc=[^>]*><\/script>[ \t]*$/gm

export type Arm = {
    name: string
    abideSources: string[]
    authoredAbide: number
    authoredVanilla: number
    shippedAbide: number
    shippedVanilla: number
    typeable: boolean
}

/** The paired examples: every `arms/<name>` with a hand-written page beside the `.abide` one. */
export function armNames(): string[] {
    const names: string[] = []
    for (const entry of new Bun.Glob('*/index.html').scanSync({
        cwd: ARMS.pathname,
    }))
        names.push(entry.slice(0, entry.indexOf('/')))
    return names
}

/** One example's two budgets, or `null` where the arm has no script to count. */
export async function armOf(
    session: TypeSession,
    name: string,
): Promise<Arm | null> {
    const abideSources = await abideSourcesOf(name)
    const vanillaScripts = [
        ...new Bun.Glob(`${name}/*.js`).scanSync({ cwd: ARMS.pathname }),
    ]
    if (vanillaScripts.length === 0) return null

    const authoredAbide = await countLines(DOGFOOD, abideSources)
    const scriptLines = await countLines(ARMS, vanillaScripts)
    // THE MARKUP IS AUTHORED TOO. A `.abide` file is counted whole, markup included, so the arm's
    // page is counted beside its scripts — less the `<script src>` that loads them, which is
    // wiring the `.abide` side has no line for.
    const markup = await Bun.file(new URL(`${name}/index.html`, ARMS)).text()
    const authoredVanilla =
        scriptLines + codeLinesOf(markup.replace(SCRIPT_TAG_LINE, ''))

    // What the browser gets: the emitted client module for each page. A page with nothing to
    // hydrate emits none, and counts zero — which is the point of that emptiness.
    let shippedAbide = 0
    let typeable = true
    // 32.17 — only a file another one INVOKES carries its own markup, so the example's whole
    // set is read before any of it is emitted. Charging every page for one is 34% of this
    // number.
    const files: { path: string; file: ReturnType<typeof parseAbide> }[] = []
    for (const source of abideSources)
        files.push({
            path: `${DOGFOOD.pathname}${source}`,
            file: parseAbide(await Bun.file(new URL(source, DOGFOOD)).text()),
        })
    // An unresolvable specifier is left as written (componentGraph's contract), not thrown.
    const { invoked } = componentGraph(files, (specifier, from) => {
        try {
            return Bun.resolveSync(specifier, from)
        } catch {
            return undefined
        }
    })
    for (const { path, file } of files) {
        let names: Awaited<ReturnType<typeof session.reads>>
        try {
            names = await session.reads(path, file)
        } catch {
            // Counted as UNTYPEABLE rather than dropped: a budget over the subset that
            // happens to work is a budget that improves by failing.
            typeable = false
            break
        }
        const client = emitClient(
            file,
            names,
            invoked.has(path) ? 'invoked' : 'none',
        )
        if (client !== '') shippedAbide += codeLinesOf(client)
        // The server module is not charged here: it never reaches a browser.
        emitComponent(file, names)
    }
    return {
        name,
        abideSources,
        authoredAbide,
        authoredVanilla,
        shippedAbide,
        // The page's markup is not charged on either side: the emitted client module is what
        // the abide arm ships as script, and its markup arrives as server-rendered HTML.
        shippedVanilla: scriptLines,
        typeable,
    }
}

async function armsFor(session: TypeSession): Promise<Arm[]> {
    const arms: Arm[] = []
    for (const name of armNames()) {
        const arm = await armOf(session, name)
        if (arm !== null) arms.push(arm)
    }
    return arms
}

async function compileCeiling(
    session: TypeSession,
    arms: Arm[],
): Promise<void> {
    const sources: { path: string; text: string }[] = []
    for (const arm of arms)
        for (const source of arm.abideSources)
            sources.push({
                path: new URL(source, DOGFOOD).pathname,
                text: await Bun.file(new URL(source, DOGFOOD)).text(),
            })

    // PARSE AND EMIT ALONE first — no checker in it — because the two costs have different
    // shapes and a single total hides which one to look at when it moves.
    const emitStart = Bun.nanoseconds()
    for (const source of sources) emitComponent(parseAbide(source.text))
    const emitNanoseconds = (Bun.nanoseconds() - emitStart) / sources.length

    // THE CHECKER LEG IS TWO NUMBERS, NOT ONE, and averaging them hides the one that matters.
    // A file the project has never seen costs several times what re-checking a known one does —
    // the root set changed, so the project is resolved again — and a FRESH BUILD is all new
    // files while a watch rebuild is all known ones. Timed on the compiler's own fixture,
    // because a file outside the session's project throws rather than measuring.
    const fixture = new URL('src/lib/', DOGFOOD).pathname
    const sample = parseAbide(sources[0]?.text ?? '')
    await session.reads(`${fixture}warm.abide`, sample)

    const knownStart = Bun.nanoseconds()
    for (let at = 0; at < ROUNDS; at += 1)
        await session.reads(`${fixture}warm.abide`, sample)
    const knownNanoseconds = (Bun.nanoseconds() - knownStart) / ROUNDS

    const freshStart = Bun.nanoseconds()
    for (let at = 0; at < ROUNDS; at += 1)
        await session.reads(`${fixture}fresh-${at}.abide`, sample)
    const freshNanoseconds = (Bun.nanoseconds() - freshStart) / ROUNDS

    // THE SAME FILES IN ONE SNAPSHOT, which is what a build does. The gap between this and the
    // line above is not a micro-optimization: it is adding a file to the project's ROOT SET
    // against asking about a file already in it.
    const batched = []
    for (let at = 0; at < ROUNDS; at += 1)
        batched.push({ path: `${fixture}batch-${at}.abide`, file: sample })
    const batchStart = Bun.nanoseconds()
    await session.readsFor(batched)
    const batchNanoseconds = (Bun.nanoseconds() - batchStart) / ROUNDS

    console.log('\nCOMPILE TIME — a ceiling, not a ratio')
    console.log(`  ${sources.length} sources, ${arms.length} paired examples`)
    console.log(
        `  parse + emit   ${(emitNanoseconds / 1000).toFixed(1)} µs per file`,
    )
    console.log(
        `  + the checker, file already in the project   ${(knownNanoseconds / 1000).toFixed(0)} µs`,
    )
    console.log(
        `  + the checker, file NEW to the project       ${(freshNanoseconds / 1000).toFixed(0)} µs  <- a fresh build is all of these`,
    )
    console.log(
        `  + the checker, NEW but sharing ONE snapshot  ${(batchNanoseconds / 1000).toFixed(0)} µs  <- what a build does`,
    )
    console.log(
        `  the batch is ${(freshNanoseconds / batchNanoseconds).toFixed(1)}x cheaper a file, so ${sources.length} sources cost about`,
    )
    console.log(
        `  ${((batchNanoseconds * sources.length) / 1e9).toFixed(2)}s in the checker rather than ${((freshNanoseconds * sources.length) / 1e9).toFixed(2)}s. What costs is adding a file to the`,
    )
    console.log(
        "  project's root set, not asking about one already in it — so a build pays it once.",
    )
    console.log(
        `  machine ${process.platform}-${process.arch}, bun ${Bun.version}, ${new Date().toISOString().slice(0, 10)}`,
    )
}

async function main(): Promise<void> {
    // The DOCS APP'S own project, not abide's. A shadow has to be inside the project that is open
    // or the checker never reads it.
    const session = await TypeSession.open(
        new URL('tsconfig.json', DOGFOOD).pathname,
    )
    try {
        const arms = await armsFor(session)
        // GLOBBED, not listed. A hand-written list of a directory's files is a second copy of
        // what the directory already says, and this one had four names in it that no longer
        // existed — the bench failed on a rename rather than reporting a bigger number.
        const runtimeFiles = [
            ...new Bun.Glob('**/*.ts').scanSync({
                cwd: new URL('packages/abide/src/ui/', REPO).pathname,
            }),
        ]
        const runtime = await countLines(
            new URL('packages/abide/src/ui/', REPO),
            runtimeFiles,
        )

        let authoredAbide = 0
        let authoredVanilla = 0
        let shippedAbide = 0
        let shippedVanilla = 0
        for (const arm of arms) {
            authoredAbide += arm.authoredAbide
            authoredVanilla += arm.authoredVanilla
            shippedAbide += arm.shippedAbide
            shippedVanilla += arm.shippedVanilla
        }

        console.log(
            'AUTHORED — what a developer writes, over the paired examples on disk',
        )
        console.log(
            `  abide ${authoredAbide}   vanilla ${authoredVanilla}   ${(authoredAbide / authoredVanilla).toFixed(2)}x`,
        )

        const typeableArms = arms.filter((arm) => arm.typeable)
        console.log('\nSHIPPED — what a browser downloads')
        console.log(
            `  + the runtime in the static closure: ${runtime} lines, charged to EVERY page`,
        )
        // NO RATIO YET, AND SAYING SO IS THE POINT. A shipped-lines ratio over the handful of
        // examples that compile today is a number about which surface happens to be built, not
        // about what the compiler costs — and it would IMPROVE every time a hard example stayed
        // broken. It appears when most of the corpus compiles.
        if (typeableArms.length < arms.length / 2) {
            console.log(
                `  no ratio: ${typeableArms.length} of ${arms.length} examples compile, so a`,
            )
            console.log(
                '  shipped-lines ratio would measure which surface is built, not what it costs.',
            )
            console.log(
                `  emitted client lines so far: ${shippedAbide} across ${typeableArms.length} example(s).`,
            )
        } else {
            console.log(
                `  emitted client ${shippedAbide}   vanilla ${shippedVanilla}   ${(shippedAbide / shippedVanilla).toFixed(2)}x`,
            )
        }

        // THE ARMS THAT DO NOT COMPILE YET are the honest denominator: a budget over the subset
        // that happens to work today is a budget that improves by failing.
        const withClient = arms.filter((arm) => arm.shippedAbide > 0).length
        const typeable = arms.filter((arm) => arm.typeable).length
        console.log(
            `\n  ${withClient} of ${arms.length} paired examples emit a client module today.`,
        )
        console.log(
            `  ${typeable} of ${arms.length} can be TYPED. An example the checker cannot reach is counted at 0`,
        )
        console.log(
            '  shipped lines rather than dropped — a budget over the subset that happens to work',
        )
        console.log(
            '  is a budget that improves by failing — so this denominator is the one to watch.',
        )

        await compileCeiling(session, arms)
    } finally {
        session.close()
    }
}

if (import.meta.main) await main()
