// ONE TEST FILE, RUN AND PARSED. `bun test` and playwright both speak JUnit, so one parser
// serves both and the tests page does not learn two shapes.
//
// ONE FILE PER PROCESS, so a row lands the moment its file finishes rather than after the
// slowest one — and a file that fails ALONE is the honest reading (CLAUDE.md, "checks").
//
// A FAILING SUITE IS A RESULT, NOT AN ERROR. This never throws on a red run — a page whose
// whole job is showing what is red cannot fall over when something is. It throws only when the
// runner produced no report at all, which is a different thing and one the page has to say out
// loud: a suite that HANGS reports nothing, and "0 failures" read off an absent file is the worst
// answer available.

import { tmpdir } from 'node:os' // bun has no temporary-directory lookup of its own

// A RUNNER THAT IS STOPPED STOPS ITS SUITES. SIGTERM reaches this process and nothing under it, so
// without passing it on a Stop orphans every `bun test` and browser still running, and the next
// run shares the machine with them — which is what turns a timing gate red.
// A killed suite never reaches the end where its JUnit file is written, so there is none to delete.
const LIVE = new Set<Bun.Subprocess>()
process.on('SIGTERM', () => {
    for (const child of LIVE) child.kill()
    process.exit(143)
})

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
    command: string[]
    reportTo: ReportTo
    cwd: string
    environment?: Record<string, string>
}): Promise<{ suites: Suite[]; milliseconds: number }> {
    const report = `${tmpdir()}/abide-suite-${crypto.randomUUID()}.xml`
    const pointed = spec.reportTo(report)
    const startedAt = Bun.nanoseconds()
    const child = Bun.spawn({
        cmd: [...spec.command, ...pointed.args],
        cwd: spec.cwd,
        env: { ...process.env, ...spec.environment, ...pointed.environment },
        stdout: 'ignore',
        stderr: 'pipe',
    })
    LIVE.add(child)
    const [stderr] = await Promise.all([
        new Response(child.stderr).text(),
        child.exited,
    ])
    LIVE.delete(child)
    const milliseconds = (Bun.nanoseconds() - startedAt) / 1e6

    const file = Bun.file(report)
    if (!(await file.exists()))
        throw new Error(
            `the runner wrote no report — a suite that HANGS or never starts reports nothing, and an absent file must not be read as zero failures.\n${stderr.slice(-2000)}`,
        )
    const suites = parseJUnit(await file.text())
    await file.delete()
    return { suites, milliseconds }
}
