// ONE FILE AT A TIME, REPORTED AS EACH LANDS. The status page's own runner, and the
// reason it is not `harness/scripts/runSuite.ts` is that the two answer different
// questions: that one runs a whole command and parses the report it leaves behind,
// which is right for playwright and cannot stream, because `bun test` writes its
// JUnit once at the end.
//
// So this pools `bun test <one file>` invocations instead. The pool is what buys the
// streaming — a row lands the moment its file finishes rather than after the slowest
// one — and it costs nothing: measured, 23 files at a pool of 8 is 15.7 s against
// `--parallel`'s 15.8 s, because `--parallel` is already one worker process per file
// and this is the same work with the scheduling moved out where it can be observed.
//
// IT IS ALSO A STRICTER READING THAN THE GATE'S. CLAUDE.md: "a file that fails ALONE
// is the honest reading". One file per process shares nothing with the file before
// it, so a suite that only passes because another one ran first fails here and
// passes under `bun run test`. That is a difference worth seeing rather than one to
// hide, and the panel says which command it ran.

// Relative, because `harness`'s `exports` map is its five ENTRIES and a script is not
// one of them (44.1). The edge used to run the other way — `harness` imported
// `buildDocs` — which is a measurement package depending on the app it measures.
import { BUN_REPORT, parseJUnit } from '../../harness/scripts/runSuite.ts'

const REPO = new URL('../../../', import.meta.url).pathname
const REPORTS = `${REPO}node_modules/.cache/abide-status/`

type SuiteCase = {
    name: string
    milliseconds: number
    failure: string | null
    skipped: boolean
}

export type SuiteResult = {
    file: string
    // Playwright's project. Empty for a `bun test` file, which has one.
    project: string
    tests: number
    passing: number
    failures: number
    skipped: number
    seconds: number
    cases: SuiteCase[]
    // Set where the runner produced no report at all, which is a different thing from
    // a red suite and the one a status page has to say out loud: a file that HANGS
    // reports nothing, and "0 failures" read off an absent file is the worst answer
    // available.
    broke: string | null
}

export type SuiteSpec = {
    label: string
    // Globbed for `**/*.test.ts`, repo-relative.
    roots: string[]
    environment?: Record<string, string>
    concurrency?: number
}

// THE LIST WITHOUT THE RUN. The page draws every row before anything has run, so the
// table is the shape of the suite rather than a shape that grows — you can see what
// is about to happen, and which file is missing when one never reports.
export function suiteFiles(spec: SuiteSpec): string[] {
    return testFilesUnder(spec.roots)
}

const DEFAULT_CONCURRENCY = 8

function testFilesUnder(roots: string[]): string[] {
    const files: string[] = []
    for (const root of roots) {
        for (const path of new Bun.Glob('**/*.test.ts').scanSync({
            cwd: `${REPO}${root}`,
            onlyFiles: true,
        })) {
            files.push(`${root}/${path}`)
        }
    }
    return files.sort()
}

export function commandFor(spec: SuiteSpec, files: number): string {
    const environment = Object.entries(spec.environment ?? {})
        .map(([key, value]) => `${key}=${value} `)
        .join('')
    return `${environment}bun test <one file> × ${files}, ${spec.concurrency ?? DEFAULT_CONCURRENCY} at a time`
}

// One report file per suite and per slot, and it is REMOVED BEFORE THE RUN. Two
// things go wrong with a path that is reused and left lying: the unit panel and the
// gates panel write slot 3 at the same time, and a file that HANGS or dies before
// writing its JUnit leaves the PREVIOUS run's report to be parsed as this one's — so
// the `broke` row this module exists to report comes back green with somebody else's
// numbers.
function reportFor(spec: SuiteSpec, at: number): string {
    return `${REPORTS}${spec.label.replaceAll(/\W+/g, '-').toLowerCase()}-${at}.xml`
}

async function runOne(
    file: string,
    spec: SuiteSpec,
    at: number,
    signal?: AbortSignal,
): Promise<SuiteResult> {
    const report = reportFor(spec, at)
    await Bun.file(report)
        .delete()
        .catch(() => {})
    const started = Bun.nanoseconds()
    const child = Bun.spawn({
        cmd: ['bun', 'test', file, ...BUN_REPORT(report).args],
        cwd: REPO,
        env: { ...process.env, ...(spec.environment ?? {}) },
        // `ignore` rather than `pipe`: nothing reads a passing file's chatter, and an
        // unread pipe is a hang waiting for a talkative test.
        stdout: 'ignore',
        stderr: 'pipe',
    })
    // CANCELLING HAS TO REACH THE CHILD. Aborting the response stream only stops the
    // page reading; the eight `bun test` processes would run to completion on a
    // machine whose owner has already asked them to stop.
    const stop = () => child.kill()
    signal?.addEventListener('abort', stop, { once: true })
    // DRAINED BEFORE THE WAIT. A piped child that fills the 64 KB buffer blocks on
    // its own write and never exits, and the pool is sitting in `await child.exited`
    // with the answer in a pipe nobody is reading — which hangs the panel rather than
    // failing it, and a panel that hangs reports nothing at all.
    const noise = new Response(child.stderr).text()
    await child.exited
    signal?.removeEventListener('abort', stop)
    const seconds = (Bun.nanoseconds() - started) / 1e9
    const xml = await Bun.file(report)
        .text()
        .catch(() => '')
    const suites = xml ? parseJUnit(xml) : []
    if (suites.length === 0) {
        const stderr = await noise
        return {
            file,
            project: '',
            tests: 0,
            passing: 0,
            failures: 0,
            skipped: 0,
            seconds,
            cases: [],
            broke:
                stderr.trim().split('\n').slice(-6).join('\n') || 'no report',
        }
    }
    // One file in, so one testsuite out — but a file declaring `describe` blocks can
    // come back as several, and they are summed rather than reported as several
    // files with one name.
    const cases: SuiteCase[] = []
    let tests = 0
    let failures = 0
    let skipped = 0
    for (const suite of suites) {
        tests += suite.tests
        failures += suite.failures
        skipped += suite.skipped
        for (const one of suite.cases) cases.push(one)
    }
    return {
        file,
        project: '',
        tests,
        passing: tests - failures - skipped,
        failures,
        skipped,
        seconds,
        cases,
        broke: null,
    }
}

export async function streamSuites(
    spec: SuiteSpec,
    onSuite: (suite: SuiteResult, done: number, total: number) => void,
    // Called as each file STARTS. With a pool of eight there are eight of these
    // outstanding at once, and a row that says which of them is in flight is the
    // difference between a table that is filling and a table that has stopped.
    onStart?: (file: string) => void,
    // One file, for the per-row button. The whole list otherwise.
    only?: string,
    signal?: AbortSignal,
): Promise<void> {
    const files = only ? [only] : testFilesUnder(spec.roots)
    let next = 0
    let done = 0
    const workers = Math.min(
        spec.concurrency ?? DEFAULT_CONCURRENCY,
        files.length,
    )
    async function worker(): Promise<void> {
        for (;;) {
            if (signal?.aborted) return
            const at = next
            next += 1
            const file = files[at]
            if (file === undefined) return
            onStart?.(file)
            const suite = await runOne(file, spec, at, signal)
            // A killed child reports nothing, and a row that says "no report" over a
            // run somebody cancelled is a failure it did not have.
            if (signal?.aborted) return
            done += 1
            onSuite(suite, done, files.length)
        }
    }
    await Promise.all(Array.from({ length: workers }, worker))
}
