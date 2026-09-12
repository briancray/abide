// THE STATUS PAGE'S ENDPOINTS. Every one of them answers in NDJSON, and that is the
// shape rather than a detail: a panel that fills a row at a time and a panel that
// answers in one number are the same reader on the client, so there is no second
// protocol to keep in step. A single-shot answer is a stream of length one.
//
// Four kinds of line: `start` (what is about to run), `suite` / `card` (one row,
// as it lands), `value` (the whole answer), `done` (the total). A thrown error
// arrives as `{ error }` rather than as a dead request half-way through a table.

import { countExportedNames } from '../../harness/scripts/countExportedNames.ts'
import { countLines } from '../../harness/scripts/countLines.ts'
import type { CardReading } from '../../harness/scripts/readExampleReadings.ts'
import {
    PLAYWRIGHT_REPORT,
    parseJUnit,
} from '../../harness/scripts/runSuite.ts'
import {
    commandFor,
    type SuiteSpec,
    streamSuites,
    suiteFiles,
} from './runSuites.ts'
import { STATUS_ENDPOINTS } from './STATUS_ENDPOINTS.ts'

const REPO = new URL('../../../', import.meta.url).pathname
const EXAMPLES = new URL('../examples/', import.meta.url)
const DIST = new URL('../dist/', import.meta.url)

// Where the browser suite's specs live. Playwright's JUnit names a spec by its
// basename, so the path is put back — a row that reads `engine.spec.ts` belongs to no
// package, and the filter above the table is by package.
const BROWSER_TEST_DIR = 'packages/harness/e2e'
const BROWSER_CONFIG = 'playwright.harness.config.ts'

const HARNESS_ENTRIES = [
    'harness/measure',
    'harness/engine',
    'harness/server',
    'harness/report',
    'harness/gate',
]

// The same three roots `bun run test` names, and they are a list here rather than a
// glob over `packages/` so a new package does not silently join the gate.
const UNIT_ROOTS = [
    'packages/abide',
    'packages/harness/tests',
    'packages/dogfood/tests',
]

const SUITES: Record<string, SuiteSpec> = {
    unit: { label: 'Unit and docs', roots: UNIT_ROOTS },
    gates: {
        label: 'Gates, with every revert run',
        roots: UNIT_ROOTS,
        environment: { HARNESS_VERIFY_GATES: '1' },
    },
}

type Send = (value: unknown) => void

// A LINE NOBODY READS, EVERY FIVE SECONDS, and it is not belt-and-braces. Bun's
// default `idleTimeout` is ten seconds and it cut the unit run at eleven — 22 of 23
// lines delivered and then `TypeError: network error` in the browser, which renders
// as a panel that ran, filled, and then said it had never run. `serveDocs` raises the
// timeout as far as Bun allows (255 s) and this covers what that cannot: the bench
// pass takes minutes, and the gap between two slow cards is the gap that kills it.
//
// The client ignores an unknown `kind`, so this costs a JSON parse and no repaint.
const HEARTBEAT_MILLISECONDS = 5_000

// THE CANCEL REACHES THE WORK. A reader who presses Cancel aborts the fetch, the
// browser cancels the response body, and `cancel()` below fires — which is the only
// place this process learns about it. Without the signal the page stops listening and
// eight `bun test` children run to completion on a machine whose owner said stop.
function ndjson(
    fill: (send: Send, signal: AbortSignal) => Promise<void>,
): Response {
    const encoder = new TextEncoder()
    const stopping = new AbortController()
    // A CANCELLED CONTROLLER THROWS ON EVERY TOUCH, and the two touches that outlive a
    // cancel are the heartbeat and the close. `cancel()` fires the moment the reader
    // goes away, `fill` runs on until it notices the signal, and an `enqueue` in that
    // window throws `Invalid state: Controller is already closed` — from a timer,
    // where it is an uncaught exception, and from the close, where it is an unhandled
    // rejection. So the flag is set by the CANCEL as well as by the end of the fill.
    let open = true
    return new Response(
        new ReadableStream({
            cancel() {
                open = false
                stopping.abort()
            },
            async start(controller) {
                const send: Send = (value) => {
                    if (!open) return
                    controller.enqueue(
                        encoder.encode(`${JSON.stringify(value)}\n`),
                    )
                }
                const heartbeat = setInterval(
                    () => send({ kind: 'alive' }),
                    HEARTBEAT_MILLISECONDS,
                )
                try {
                    await fill(send, stopping.signal)
                } catch (error) {
                    send({
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    })
                } finally {
                    clearInterval(heartbeat)
                }
                if (!open) return
                open = false
                controller.close()
            },
        }),
        { headers: { 'content-type': 'application/x-ndjson' } },
    )
}

// `only` is one file, from the per-row button. The whole list otherwise, and either
// way the FIRST line carries every file the panel is about — the page draws the table
// before anything has run, so a suite is a row that fills rather than a row that
// appears. A single-file run says so, and the page merges it into the table it has
// instead of starting a new one.
function runBunSuites(spec: SuiteSpec, only?: string): Response {
    return ndjson(async (send, signal) => {
        const started = Bun.nanoseconds()
        const files = only ? [only] : suiteFiles(spec)
        send({
            kind: 'start',
            command: commandFor(spec, files.length),
            files,
            only: only ?? null,
        })
        await streamSuites(
            spec,
            (suite, done, total) => send({ kind: 'suite', suite, done, total }),
            (file) => send({ kind: 'running', file }),
            only,
            signal,
        )
        send({ kind: 'done', seconds: (Bun.nanoseconds() - started) / 1e9 })
    })
}

// PLAYWRIGHT DOES NOT STREAM HERE and the panel says so rather than pretending. Its
// JUnit lands once, at the end, and splitting the run per spec file to fake the
// streaming would run the two projects six times instead of twice for a suite that
// finishes in ten seconds. The rows arrive together; the shape is the same.
function runBrowserSuites(): Response {
    return ndjson(async (send, signal) => {
        const available =
            Bun.spawnSync({
                cmd: ['bunx', 'playwright', '--version'],
                cwd: REPO,
                stdout: 'pipe',
                stderr: 'pipe',
            }).exitCode === 0
        const command = `bunx playwright test --config ${BROWSER_CONFIG}`
        if (!available) {
            send({
                kind: 'start',
                command,
                unavailable: 'playwright is not installed here',
            })
            return
        }
        send({ kind: 'start', command })
        const report = `${REPO}node_modules/.cache/abide-status/browser.xml`
        // REMOVED BEFORE THE RUN. A killed or crashed playwright writes no report and
        // the one left from last time parses perfectly — a green table over a run that
        // never produced it, which is the reading `broke` exists to refuse.
        await Bun.file(report)
            .delete()
            .catch(() => {})
        const started = Bun.nanoseconds()
        // `PLAYWRIGHT_REPORT` RATHER THAN THE TWO LINES IT IS. Spelled out here, the
        // environment variable went in and `--reporter=junit` did not — and the
        // variable alone only NAMES the file the junit reporter would write, so the
        // config's `list` reporter ran, nothing wrote a report, and the panel said
        // "playwright produced no report" about a suite that had passed. The harness
        // exports this exactly so it is not re-derived.
        const reporting = PLAYWRIGHT_REPORT(report)
        const child = Bun.spawn({
            cmd: [
                'bunx',
                'playwright',
                'test',
                '--config',
                BROWSER_CONFIG,
                ...reporting.args,
            ],
            cwd: REPO,
            env: { ...process.env, ...reporting.environment },
            // `ignore` rather than `pipe` for the same reason `runSuites.ts` gives:
            // nothing here reads playwright's stdout, and an unread pipe is a child
            // blocked on its own write at 64 KB with the caller sitting in
            // `await child.exited` forever.
            stdout: 'ignore',
            stderr: 'pipe',
        })
        // Cancelling has to reach the child, for the reason `runSuites.ts` states.
        const stop = () => child.kill()
        signal.addEventListener('abort', stop, { once: true })
        // DRAINED BEFORE THE WAIT, not after. A piped child that fills the 64 KB
        // buffer blocks on its own write and never exits, and the caller is sitting
        // in `await child.exited` with the answer in a pipe nobody is reading.
        const output = new Response(child.stderr).text()
        await child.exited
        signal.removeEventListener('abort', stop)
        // A killed run reports nothing, and "produced no report" is a failure it did
        // not have.
        if (signal.aborted) return
        const seconds = (Bun.nanoseconds() - started) / 1e9
        const xml = await Bun.file(report)
            .text()
            .catch(() => '')
        const suites = xml ? parseJUnit(xml) : []
        if (suites.length === 0) {
            send({
                error:
                    (await output).trim().split('\n').slice(-8).join('\n') ||
                    'playwright produced no report',
            })
            return
        }
        for (let at = 0; at < suites.length; at += 1) {
            const suite = suites[at]
            if (!suite) continue
            send({
                kind: 'suite',
                done: at + 1,
                total: suites.length,
                suite: {
                    file: `${BROWSER_TEST_DIR}/${suite.file}`,
                    project: suite.project,
                    tests: suite.tests,
                    passing: suite.tests - suite.failures - suite.skipped,
                    failures: suite.failures,
                    skipped: suite.skipped,
                    seconds: 0,
                    cases: suite.cases,
                    broke: null,
                },
            })
        }
        send({ kind: 'done', seconds })
    })
}

// THE LISTING, AND IT RUNS NOTHING. Every panel with a table can say what is in it
// before anything has been measured, and that is the difference between a table that
// reports on a run and a table that IS the thing being checked. An empty panel
// answers "no" to the question "what would this cover?", which is the one question a
// reader opens this page with.
//
// FOUR SOURCES AND NOT ONE HAND-KEPT LIST: the two bun suites are globs, the
// browser's rows are its spec files crossed with the projects its own config
// declares, the per-operation rows are what the bench prints when asked to `--list`,
// and the bench cards are the example figures in the built pages.
type ListedRow = { label: string; project: string }

// THE SPEC FILES CROSSED WITH THE PROJECTS THE CONFIG DECLARES. Read off the config
// rather than named here, or a third engine joins the run and not the table.
async function browserRows(): Promise<ListedRow[]> {
    const specs = [
        ...new Bun.Glob('**/*.spec.ts').scanSync({
            cwd: `${REPO}${BROWSER_TEST_DIR}`,
            onlyFiles: true,
        }),
    ].sort()
    let projects: string[] = []
    try {
        // Lazily, so `@playwright/test` is not a dependency of serving the docs.
        const config = (await import(`${REPO}${BROWSER_CONFIG}`)) as {
            default?: { projects?: { name: string }[] }
        }
        projects = (config.default?.projects ?? []).map((one) => one.name)
    } catch {
        projects = []
    }
    const rows: ListedRow[] = []
    for (const project of projects.length > 0 ? projects : ['']) {
        for (const spec of specs)
            rows.push({ label: `${BROWSER_TEST_DIR}/${spec}`, project })
    }
    return rows
}

// ASKED OF THE CHILD, not imported. `cases()` builds live reactive graphs at call
// time, and a server that wants nine strings should not be holding them.
async function reactiveCases(): Promise<ListedRow[]> {
    const child = Bun.spawn({
        cmd: ['bun', 'packages/abide/bench/reactive.ts', '--list'],
        cwd: REPO,
        stdout: 'pipe',
        stderr: 'ignore',
    })
    const printed = await new Response(child.stdout).text()
    await child.exited
    try {
        return (JSON.parse(printed.trim()) as string[]).map((label) => ({
            label,
            project: '',
        }))
    } catch {
        return []
    }
}

// THE CARDS IN THE BUILT PAGES, which is what the bench pass walks. Read off the
// OUTPUT rather than off `examples/`: one example directory can be embedded by more
// than one page, and it is the card that gets measured.
async function cardRows(): Promise<ListedRow[]> {
    const rows: ListedRow[] = []
    for (const path of new Bun.Glob('**/*.html').scanSync({
        cwd: DIST.pathname,
        onlyFiles: true,
    })) {
        if (path === 'status.html') continue
        const html = await Bun.file(new URL(path, DIST)).text()
        for (const match of html.matchAll(
            /class="ex-title">([\s\S]*?)<\/span>/g,
        )) {
            // Tags out, then ENTITIES back: a card called `<style>` is written
            // `&lt;style&gt;` in the output, and a table showing that is showing the
            // markup rather than the name.
            const label = (match[1] ?? '')
                .replace(/<[^>]*>/g, '')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&amp;/g, '&')
                .replace(/\s+/g, ' ')
                .trim()
            if (label) rows.push({ label, project: path })
        }
    }
    return rows
}

function suiteListing(): Response {
    return ndjson(async (send) => {
        const value: Record<string, { command: string; rows: ListedRow[] }> = {}
        for (const [name, spec] of Object.entries(SUITES)) {
            const files = suiteFiles(spec)
            value[name] = {
                command: commandFor(spec, files.length),
                rows: files.map((label) => ({ label, project: '' })),
            }
        }
        value.browser = {
            command: `bunx playwright test --config ${BROWSER_CONFIG}`,
            rows: await browserRows(),
        }
        value.ops = {
            command: 'bun packages/abide/bench/reactive.ts',
            rows: await reactiveCases(),
        }
        value.bench = {
            command: 'chromium, over every example card in the built docs',
            rows: await cardRows(),
        }
        send({ kind: 'value', value })
    })
}

function benchCards(): Response {
    return ndjson(async (send, signal) => {
        send({ kind: 'start' })
        // IMPORTED WHERE IT IS CALLED, not at module scope. This module is reached
        // from `buildDocs`, and `readExampleReadings` drives a browser — a static
        // edge would make `@playwright/test` a dependency of building the
        // documentation, for a panel nobody pressed. An import edge is priced by the
        // module it lands on.
        const { readExampleReadings } = await import(
            '../../harness/scripts/readExampleReadings.ts'
        )
        await readExampleReadings(
            (card: CardReading, done: number, total: number) =>
                send({ kind: 'card', card, done, total }),
            () => signal.aborted,
        )
        send({ kind: 'done' })
    })
}

// THE PER-OPERATION RATIOS, in a child. `batch()` refuses a sample taken in a
// parallel worker and refuses one whose op touched an emulated DOM, and this server
// is neither — but the bench holds live reactive graphs for the length of a run, and
// a server process is the wrong place to keep them. A child also means a cancelled
// run is a killed process rather than a loop nobody is reading.
function reactiveBench(): Response {
    return ndjson(async (send, signal) => {
        send({ kind: 'start' })
        const child = Bun.spawn({
            cmd: ['bun', 'packages/abide/bench/reactive.ts', '--json'],
            cwd: REPO,
            stdout: 'pipe',
            stderr: 'pipe',
        })
        const stop = () => child.kill()
        signal.addEventListener('abort', stop, { once: true })
        const noise = new Response(child.stderr).text()
        const reader = (child.stdout as ReadableStream).getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
            const chunk = await reader.read()
            if (chunk.done) break
            buffer += decoder.decode(chunk.value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
                if (!line.trim()) continue
                const message = JSON.parse(line) as {
                    row: unknown
                    done: number
                    total: number
                }
                send({ kind: 'op', ...message })
            }
        }
        await child.exited
        signal.removeEventListener('abort', stop)
        if (signal.aborted) return
        if (child.exitCode !== 0)
            send({
                error:
                    (await noise).trim().split('\n').slice(-8).join('\n') ||
                    'the reactive bench produced nothing',
            })
        else send({ kind: 'done' })
    })
}

function counted(): Response {
    return ndjson(async (send) => {
        const rows = []
        for (const path of new Bun.Glob('*/example.json').scanSync({
            cwd: EXAMPLES.pathname,
        })) {
            const example = path.slice(0, path.indexOf('/'))
            const manifest = (await Bun.file(
                new URL(path, EXAMPLES),
            ).json()) as {
                bench?: {
                    rows: {
                        metric: string
                        abide: string
                        vanilla: string
                        ratio: string
                    }[]
                }
            }
            for (const row of manifest.bench?.rows ?? [])
                rows.push({ example, ...row })
        }
        send({ kind: 'value', value: { rows } })
    })
}

function machinery(): Response {
    return ndjson(async (send) => {
        const source = new URL('../../harness/src/', import.meta.url)
        const files = [
            ...new Bun.Glob('**/*.ts').scanSync({
                cwd: source.pathname,
                onlyFiles: true,
            }),
        ]
        send({
            kind: 'value',
            value: {
                lines: await countLines(source, files),
                files: files.length,
                names: await countExportedNames(HARNESS_ENTRIES),
            },
        })
    })
}

// The one export the server takes: a request in, a `Response` or `null` out. `null` is
// "not mine", which is what lets the docs server fall through to a file without this
// module knowing anything about where the docs are.
//
// The REQUEST rather than the path, because `?file=` is what the per-row button adds
// and the endpoint it adds it to is one of the six below. Matching on `pathname`
// keeps `STATUS_ENDPOINTS` a list of paths rather than a list of URLs.
export function statusRoute(request: Request): Response | null {
    const url = new URL(request.url)
    const path = url.pathname
    if (!(STATUS_ENDPOINTS as readonly string[]).includes(path)) return null
    if (path === '/api/suites') return suiteListing()
    const suite = /^\/api\/run\/(\w+)$/.exec(path)?.[1]
    if (suite === 'browser') return runBrowserSuites()
    if (suite && SUITES[suite]) {
        const only = url.searchParams.get('file')
        // A file the glob does not name is not a file this runs. Without the check
        // the query is a path handed to `bun test` from a URL.
        if (
            only !== null &&
            !suiteFiles(SUITES[suite] as SuiteSpec).includes(only)
        )
            return new Response('no such suite', { status: 404 })
        return runBunSuites(SUITES[suite] as SuiteSpec, only ?? undefined)
    }
    if (path === '/api/bench') return benchCards()
    if (path === '/api/bench/reactive') return reactiveBench()
    if (path === '/api/counted') return counted()
    return machinery()
}
