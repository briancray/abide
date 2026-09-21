// THE BUILD'S OWN PAGE, SERVED LIVE. Every suite's pass and fail, every counted
// benchmark, the machinery triple, and a browser pass over every example card —
// each behind an endpoint the reader triggers.
//
// IT HOLDS NO RESULTS AND WRITES NO FILE. A generated page could not survive its own
// neighbours — the docs build starts from an empty output and deleted it every time,
// including on the way to serving it. A page the server owns has no ordering to get
// right, and a page that fetches has the property the static one never could, which
// is that you leave it open while you work.
//
// NOT IN THE DOCS NAV. A page in `content/` is governed as documentation — a lead on
// the main overview, a `covers` line, the voice rules — and none of that is true of
// an instrument.

import { countExportedNames } from './countExportedNames.ts'
import { countLines } from './countLines.ts'
import { type CardReading, readExampleReadings } from './readExampleReadings.ts'
import {
    BUN_REPORT,
    PLAYWRIGHT_REPORT,
    runSuite,
    type SuiteRun,
} from './runSuite.ts'
import { STATUS_PAGE } from './STATUS_PAGE.ts'
import { STATUS_SCRIPT } from './STATUS_SCRIPT.ts'
import { serveDocsApp } from './serveDocsApp.ts'

const REPO = new URL('../../../', import.meta.url).pathname
const EXAMPLES = new URL('../../dogfood/examples/', import.meta.url)

const HARNESS_ENTRIES = [
    'harness/measure',
    'harness/engine',
    'harness/server',
    'harness/report',
    'harness/gate',
]

const UNIT_PATHS = [
    'packages/abide',
    'packages/harness/tests',
    'packages/dogfood/tests',
]

const SUITES: Record<string, () => Promise<SuiteRun>> = {
    unit: () =>
        runSuite({
            label: 'Unit and docs',
            command: ['bun', 'test', ...UNIT_PATHS, '--parallel'],
            reportTo: BUN_REPORT,
            cwd: REPO,
        }),
    gates: () =>
        runSuite({
            label: 'Gates, with every revert run',
            command: ['bun', 'test', ...UNIT_PATHS],
            reportTo: BUN_REPORT,
            cwd: REPO,
            environment: { HARNESS_VERIFY_GATES: '1' },
        }),
    browser: () =>
        runSuite({
            label: 'Browser, chromium and webkit',
            // THE HARNESS PAIR OF THE ONE CONFIG. They were a config of their own while
            // `abide start` threw and `webServer` could not boot; naming the projects is
            // what replaced that, and it keeps this row the measure lane rather than the
            // whole browser gate.
            command: [
                'bunx',
                'playwright',
                'test',
                '--project',
                'harness',
                '--project',
                'harness-webkit',
            ],
            reportTo: PLAYWRIGHT_REPORT,
            cwd: REPO,
            skipWhen: () =>
                Bun.spawnSync({
                    cmd: ['bunx', 'playwright', '--version'],
                    cwd: REPO,
                    stdout: 'pipe',
                    stderr: 'pipe',
                }).exitCode === 0
                    ? null
                    : 'playwright is not installed here',
        }),
}

async function counted(): Promise<{
    rows: {
        example: string
        metric: string
        abide: string
        vanilla: string
        ratio: string
    }[]
}> {
    const rows = []
    for (const path of new Bun.Glob('*/example.json').scanSync({
        cwd: EXAMPLES.pathname,
    })) {
        const example = path.slice(0, path.indexOf('/'))
        const manifest = (await Bun.file(new URL(path, EXAMPLES)).json()) as {
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
    return { rows }
}

async function machinery(): Promise<{
    lines: number
    files: number
    names: Awaited<ReturnType<typeof countExportedNames>>
}> {
    const source = new URL('../src/', import.meta.url)
    const files = [
        ...new Bun.Glob('**/*.ts').scanSync({
            cwd: source.pathname,
            onlyFiles: true,
        }),
    ]
    return {
        lines: await countLines(source, files),
        files: files.length,
        names: await countExportedNames(HARNESS_ENTRIES),
    }
}

function json(value: unknown): Response {
    return Response.json(value)
}

// NDJSON, one line per card. A pass that takes minutes fills the table as it goes,
// and a failure part-way through arrives as a line rather than as a dead request.
function streamedMeasure(): Response {
    const encoder = new TextEncoder()
    return new Response(
        new ReadableStream({
            async start(controller) {
                const send = (value: unknown): void => {
                    controller.enqueue(
                        encoder.encode(`${JSON.stringify(value)}\n`),
                    )
                }
                try {
                    await readExampleReadings(
                        (card: CardReading, done: number, total: number) =>
                            send({ card, done, total }),
                    )
                } catch (error) {
                    send({
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    })
                }
                controller.close()
            },
        }),
        { headers: { 'content-type': 'application/x-ndjson' } },
    )
}

export async function serveStatus(): Promise<void> {
    // THE DOCS ARE AN APP NOW, so they are not files to read out of a directory: `abide start`
    // serves them on a socket of its own and this forwards everything that is not the status
    // page to it. One address either way, which is what keeps a card one click from the numbers
    // about it.
    const docs = await serveDocsApp()

    const server = Bun.serve({
        port: Number(process.env.DOCS_PORT ?? 4000),
        async fetch(request) {
            const path = new URL(request.url).pathname
            if (path === '/status' || path === '/status.html')
                return new Response(STATUS_PAGE, {
                    headers: { 'content-type': 'text/html' },
                })
            if (path === '/status.js')
                return new Response(STATUS_SCRIPT, {
                    headers: { 'content-type': 'text/javascript' },
                })

            const suite = /^\/api\/run\/(\w+)$/.exec(path)?.[1]
            if (suite && SUITES[suite]) return json(await SUITES[suite]())
            if (path === '/api/counted') return json(await counted())
            if (path === '/api/machinery') return json(await machinery())
            if (path === '/api/measure') return streamedMeasure()

            return await fetch(
                `${docs.origin}${path}${new URL(request.url).search}`,
                {
                    method: request.method,
                    headers: request.headers,
                },
            )
        },
    })
    console.log(`status: ${server.url}status`)
    console.log(`docs:   ${server.url}`)
}

if (import.meta.main) await serveStatus()
