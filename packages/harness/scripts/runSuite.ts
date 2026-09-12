// A SUITE REPORT, PARSED. `bun test` and playwright both speak JUnit, so one parser
// serves both and the status page does not learn two shapes.
//
// A FAILING SUITE IS A RESULT, NOT AN ERROR: this never throws on a red run, and a
// status page whose whole job is showing what is red cannot fall over when something
// is. What it CANNOT answer is a runner that produced no report at all — an absent
// file parses as zero suites and "0 failures" read off one is the worst answer
// available — so the caller owns that, which is `runSuites.ts`'s `broke`.
//
// The runner that used to live here went with `serveStatus.ts`; `runSuites.ts` runs
// one file at a time so a row can land as it finishes, and these are what it points
// a child at.

export type SuiteCase = {
    name: string
    milliseconds: number
    failure: string | null
    // A case the runner did not run. Playwright writes `<skipped/>` inside the
    // `<testcase>`; `bun test` reports it in the suite's `skipped` count and not per
    // case, so this is false there.
    skipped: boolean
}

export type Suite = {
    file: string
    // The PROJECT, which playwright writes into `hostname`. Two projects over one
    // spec file produce two `<testsuite>` entries with the same `name`, so a reader
    // keyed on the file alone shows one of them and silently drops the other — the
    // webkit run overwrote the chromium one and a skipped-on-webkit spec read as
    // 0 passing. Empty for `bun test`, which has no such axis.
    project: string
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
                // `|| 0`, and it is not belt-and-braces: a SKIPPED playwright case
                // carries no `time`, so the parse was `NaN` — and `NaN` DOES NOT
                // SURVIVE JSON. `JSON.stringify` writes it as `null`, so a consumer
                // on the other side of a wire receives a null where the type above
                // says `number`, and the first thing it does with it throws. The two
                // skipped webkit cases crashed the status page's whole browser panel
                // that way, reporting a TypeError over a suite that had passed.
                milliseconds:
                    Number.parseFloat(attribute(caseHead, 'time')) * 1000 || 0,
                failure: failure ? unescapeXml(failure[1] ?? '') : null,
                skipped: /<skipped[\s/>]/.test(entry),
            })
        }
        suites.push({
            file: attribute(head, 'name'),
            project: attribute(head, 'hostname'),
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
