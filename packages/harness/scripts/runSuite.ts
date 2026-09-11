// A SUITE, RUN AND PARSED. `bun test` and playwright both speak JUnit, so one parser
// serves both and the status page does not learn two shapes.
//
// A FAILING SUITE IS A RESULT, NOT AN ERROR. This never throws on a red run — a
// status page whose whole job is showing what is red cannot fall over when something
// is. It throws only when the runner produced no report at all, which is a different
// thing and one the page has to say out loud: a suite that HANGS reports nothing, and
// "0 failures" read off an absent file is the worst answer available.

export type SuiteCase = {
    name: string
    milliseconds: number
    failure: string | null
}

export type Suite = {
    file: string
    tests: number
    failures: number
    skipped: number
    cases: SuiteCase[]
}

export type SuiteRun = {
    label: string
    command: string
    ran: boolean
    // Why it did not run, where it did not. An absent browser is not a red suite.
    unavailable: string | null
    seconds: number
    tests: number
    failures: number
    skipped: number
    suites: Suite[]
}

function attribute(tag: string, name: string): string {
    return new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? ''
}

function unescapeXml(value: string): string {
    return value
        .replaceAll('&#10;', '\n')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&')
}

export function parseJUnit(xml: string): Suite[] {
    const suites: Suite[] = []
    for (const block of xml.split('<testsuite ').slice(1)) {
        const head = block.slice(0, block.indexOf('>'))
        const cases: SuiteCase[] = []
        for (const entry of block.split('<testcase ').slice(1)) {
            const caseHead = entry.slice(0, entry.indexOf('>'))
            const failure = /<failure[^>]*message="([^"]*)"/.exec(entry)
            cases.push({
                name: unescapeXml(attribute(caseHead, 'name')),
                milliseconds:
                    Number.parseFloat(attribute(caseHead, 'time')) * 1000,
                failure: failure ? unescapeXml(failure[1] ?? '') : null,
            })
        }
        suites.push({
            file: attribute(head, 'name'),
            tests: Number.parseInt(attribute(head, 'tests'), 10) || 0,
            failures: Number.parseInt(attribute(head, 'failures'), 10) || 0,
            skipped: Number.parseInt(attribute(head, 'skipped'), 10) || 0,
            cases,
        })
    }
    return suites
}

// HOW A RUNNER IS POINTED AT ITS REPORT, supplied by the caller rather than branched
// on here: `bun test` takes `--reporter-outfile` and playwright takes
// `PLAYWRIGHT_JUNIT_OUTPUT_NAME`, and a runner that took a third spelling would be a
// third caller rather than a third branch.
export type ReportTo = (path: string) => {
    args: string[]
    environment: Record<string, string>
}

export const BUN_REPORT: ReportTo = (path) => ({
    args: ['--reporter=junit', `--reporter-outfile=${path}`],
    environment: {},
})

export const PLAYWRIGHT_REPORT: ReportTo = (path) => ({
    args: ['--reporter=junit'],
    environment: { PLAYWRIGHT_JUNIT_OUTPUT_NAME: path },
})

export async function runSuite(spec: {
    label: string
    command: string[]
    reportTo: ReportTo
    cwd: string
    environment?: Record<string, string>
    // Where the runner could not be used at all — no browser installed, say.
    skipWhen?: () => string | null
}): Promise<SuiteRun> {
    const empty = {
        label: spec.label,
        command: spec.command.join(' '),
        seconds: 0,
        tests: 0,
        failures: 0,
        skipped: 0,
        suites: [] as Suite[],
    }
    const unavailable = spec.skipWhen?.() ?? null
    if (unavailable) return { ...empty, ran: false, unavailable }

    const report = `${spec.cwd}/.status-${spec.label.replaceAll(/\W+/g, '-')}.xml`
    const pointed = spec.reportTo(report)
    const startedAt = Bun.nanoseconds()
    Bun.spawnSync({
        cmd: [...spec.command, ...pointed.args],
        cwd: spec.cwd,
        env: { ...process.env, ...spec.environment, ...pointed.environment },
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const seconds = (Bun.nanoseconds() - startedAt) / 1e9

    const file = Bun.file(report)
    if (!(await file.exists()))
        throw new Error(
            `${spec.label}: the runner wrote no report. A suite that HANGS reports nothing at all, and an absent file must not be read as zero failures.`,
        )
    const suites = parseJUnit(await file.text())
    await file.delete()

    let tests = 0
    let failures = 0
    let skipped = 0
    for (const suite of suites) {
        tests += suite.tests
        failures += suite.failures
        skipped += suite.skipped
    }
    return {
        ...empty,
        ran: true,
        unavailable: null,
        seconds,
        tests,
        failures,
        skipped,
        suites,
    }
}
