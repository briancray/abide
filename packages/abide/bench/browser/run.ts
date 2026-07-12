/*
Browser render-bench runner. Bundles `harness.ts` for the browser, serves it,
launches headless Google Chrome, drives it over the DevTools Protocol (raw
WebSocket — zero test-runner dependencies), invokes `window.__bench.runAll()`, and
prints an abide-vs-vanilla comparison table. Run:

  bun packages/abide/bench/browser/run.ts

Flags:
  --serve   Just build + serve at http://localhost:<port> for manual viewing
            (open /?driver=abide to watch abide mutate a 1k list). No Chrome.
  --headed  Launch a visible Chrome window instead of headless.

Needs Google Chrome installed (see CHROME candidates below).
*/

import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { file } from 'bun'

const CHROME_CANDIDATES = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
]

const HERE = new URL('.', import.meta.url).pathname
const serveOnly = process.argv.includes('--serve')
const headed = process.argv.includes('--headed')

/* Bundle the in-page harness for the browser (resolves the abide src imports). */
const build = await Bun.build({
    entrypoints: [`${HERE}harness.ts`],
    target: 'browser',
    minify: false,
})
if (!build.success) {
    for (const log of build.logs) {
        console.error(log)
    }
    process.exit(1)
}
const [bundleArtifact] = build.outputs
if (!bundleArtifact) {
    console.error('build produced no output artifact')
    process.exit(1)
}
const bundle = await bundleArtifact.text()
const indexHtml = await file(`${HERE}index.html`).text()

/* Serve the page + bundle on an ephemeral port. */
const server = Bun.serve({
    port: 0,
    fetch(request) {
        const path = new URL(request.url).pathname
        if (path === '/harness.js') {
            return new Response(bundle, { headers: { 'content-type': 'text/javascript' } })
        }
        return new Response(indexHtml, { headers: { 'content-type': 'text/html' } })
    },
})
const pageUrl = `http://localhost:${server.port}/`

if (serveOnly) {
    console.log(`serving ${pageUrl} (Ctrl-C to stop) — try ${pageUrl}?driver=abide`)
} else {
    try {
        const report = await driveChrome(pageUrl)
        printTable(report)
    } finally {
        server.stop(true)
    }
}

/* --- headless Chrome over the DevTools Protocol --- */

type BenchReport = {
    drivers: Record<string, Record<string, number>>
    operations: string[]
    userAgent: string
}

async function driveChrome(url: string): Promise<BenchReport> {
    const binary = CHROME_CANDIDATES.find((path) => existsSync(path))
    if (binary === undefined) {
        throw new Error(`Chrome not found. Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`)
    }
    const profile = `${HERE}.chrome-profile`
    const args = [
        headed ? '--no-first-run' : '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        'about:blank',
    ]
    const proc = Bun.spawn([binary, ...args], { stdout: 'pipe', stderr: 'pipe' })
    try {
        const wsUrl = await readDevToolsWsUrl(profile)
        const browser = new CdpClient(wsUrl)
        await browser.open()
        /* Create a fresh tab and attach a flat session to it. */
        const created = (await browser.send('Target.createTarget', { url: 'about:blank' })) as {
            targetId: string
        }
        const attached = (await browser.send('Target.attachToTarget', {
            targetId: created.targetId,
            flatten: true,
        })) as { sessionId: string }
        const session = attached.sessionId
        await browser.send('Page.enable', {}, session)
        await browser.send('Runtime.enable', {}, session)
        /* Navigate and wait for the module to define window.__bench. */
        await browser.send('Page.navigate', { url }, session)
        await waitFor(async () => {
            const ready = (await browser.send(
                'Runtime.evaluate',
                { expression: 'typeof window.__bench !== "undefined"', returnByValue: true },
                session,
            )) as { result: { value: boolean } }
            return ready.result.value === true
        })
        /* Run the whole suite in-page and pull back the JSON report. */
        const evaluated = (await browser.send(
            'Runtime.evaluate',
            {
                expression: 'JSON.stringify(window.__bench.runAll())',
                returnByValue: true,
                awaitPromise: true,
            },
            session,
        )) as { result: { value: string }; exceptionDetails?: unknown }
        if (evaluated.exceptionDetails !== undefined) {
            throw new Error(`in-page bench threw: ${JSON.stringify(evaluated.exceptionDetails)}`)
        }
        browser.close()
        return JSON.parse(evaluated.result.value) as BenchReport
    } finally {
        proc.kill()
        await rm(`${HERE}.chrome-profile`, { recursive: true, force: true })
    }
}

/* Chrome writes the chosen debug port to DevToolsActivePort in the profile dir a
   moment after launch. Poll for it, then GET the browser websocket endpoint. */
async function readDevToolsWsUrl(profile: string): Promise<string> {
    const portFile = `${profile}/DevToolsActivePort`
    let port = ''
    await waitFor(async () => {
        const handle = Bun.file(portFile)
        if (!(await handle.exists())) {
            return false
        }
        const contents = (await handle.text()).trim().split('\n')
        if (contents.length < 1 || contents[0] === '') {
            return false
        }
        port = contents[0] as string
        return true
    })
    const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as {
        webSocketDebuggerUrl: string
    }
    return version.webSocketDebuggerUrl
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 30000): Promise<void> {
    const deadline = performance.now() + timeoutMs
    while (performance.now() < deadline) {
        if (await predicate()) {
            return
        }
        await Bun.sleep(50)
    }
    throw new Error('timed out waiting for Chrome')
}

/* Minimal CDP client: send returns the matching result by id; sessionId routes to
   an attached target. */
class CdpClient {
    private socket!: WebSocket
    private nextId = 1
    private pending = new Map<
        number,
        { resolve: (value: unknown) => void; reject: (error: unknown) => void }
    >()
    constructor(private readonly url: string) {}

    open(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket = new WebSocket(this.url)
            this.socket.addEventListener('open', () => resolve())
            this.socket.addEventListener('error', (event) => reject(event))
            this.socket.addEventListener('message', (event) => {
                const message = JSON.parse(event.data as string) as {
                    id?: number
                    result?: unknown
                    error?: { message: string }
                }
                if (message.id === undefined) {
                    return
                }
                const waiter = this.pending.get(message.id)
                if (waiter === undefined) {
                    return
                }
                this.pending.delete(message.id)
                if (message.error !== undefined) {
                    waiter.reject(new Error(message.error.message))
                } else {
                    waiter.resolve(message.result)
                }
            })
        })
    }

    send(method: string, params: unknown, sessionId?: string): Promise<unknown> {
        const id = this.nextId++
        const payload: Record<string, unknown> = { id, method, params }
        if (sessionId !== undefined) {
            payload.sessionId = sessionId
        }
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject })
            this.socket.send(JSON.stringify(payload))
        })
    }

    close(): void {
        this.socket.close()
    }
}

/* --- reporting --- */

function printTable(report: BenchReport): void {
    const driverNames = Object.keys(report.drivers)
    const baseline = report.drivers.vanilla ?? {}
    console.log(`\nbrowser render bench — ${report.userAgent}\n`)
    const nameWidth = Math.max(
        'operation'.length,
        ...report.operations.map((operation) => operation.length),
    )
    const cell = (text: string) => text.padStart(11)
    /* Per driver: an absolute-ms column, plus a ratio-vs-vanilla column for the
       non-baseline drivers. */
    let header = 'operation'.padEnd(nameWidth)
    for (const name of driverNames) {
        header += `   ${cell(name)}`
        if (name !== 'vanilla') {
            header += `   ${cell(`${name}/van`)}`
        }
    }
    console.log(header)
    console.log('-'.repeat(header.length))
    for (const operation of report.operations) {
        let line = operation.padEnd(nameWidth)
        const base = baseline[operation] ?? Number.NaN
        for (const name of driverNames) {
            const value = report.drivers[name]?.[operation] ?? Number.NaN
            line += `   ${cell(`${value.toFixed(2)}ms`)}`
            if (name !== 'vanilla') {
                /* Below ~0.1ms both sides sit at Chrome's performance.now() clamp, so a
                   ratio is noise — mark it rather than print a divide-by-tiny artefact. */
                const ratio = base < 0.1 || value < 0.1 ? 'floor' : `${(value / base).toFixed(2)}×`
                line += `   ${cell(ratio)}`
            }
        }
        console.log(line)
    }
    console.log(
        '\nRatios are relative to the keyed-vanilla baseline (1.00× = parity, lower = faster).',
    )
    console.log(
        'Absolute ms are layout-flushed medians under headless Chrome, not the public paint-timeline numbers — compare ratios across machines, not raw ms.\n',
    )
}
