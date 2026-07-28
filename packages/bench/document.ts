// DOCUMENT BENCH RUNNER — request → TTFB → complete → boot-discoverable.
//
//   bun run bench:document                 # human table, every shape
//   bun run bench:document -- --json       # machine-readable JSON
//   bun run bench:document -- --list       # print the labels, run nothing
//   bun run bench:document -- streamed     # run only the shapes matching these patterns
//
// WHY THIS EXISTS. `run.ts` measures `render` (a string built in memory) and `server.ts` measures RPC
// dispatch. Neither measures the DOCUMENT: the bytes a browser actually waits on. The cost that lives
// between them was therefore invisible, and one such cost shipped — the boot `<script>` sits in
// `documentTail`, so the browser could not discover the client bundle until the whole streamed drain
// had finished. On a page with one slow read that was 128ms instead of 7ms; on a heavy one, 4494ms
// instead of 364ms. Every existing runner was green throughout, because none of them looks at when a
// byte ARRIVES.
//
// THE THREE NUMBERS (PERFORMANCE.md §4, transposed from emitted code to the request path):
//   • ttfb      request → first byte           — the shell render, everything blocking
//   • complete  request → last byte            — plus the streamed drain
//   • boot      request → the byte at which the boot entry URL is first readable
//
// `boot` is the one that matters and the one nobody had. It is where a browser can START fetching the
// client bundle, and it is the metric that DISTINGUISHES the two implementations (§8): with the boot
// graph preloaded in the head it tracks `ttfb`, and without it, `complete`. A page with no reads cannot
// tell them apart — `ttfb` and `complete` coincide there — which is exactly why the defect survived.
// The reported `coupling` is `boot ÷ ttfb`: 1.0 means the client download is independent of how long
// this page's reads take, which is the contract streaming SSR is supposed to provide.
//
// DISTRIBUTIONS, NOT MEANS. The question this runner answers is usually "why is it sometimes slow",
// so it reports p50/p90/p99/max. A mean over a long thin tail describes neither mode.
//
// THE BASELINE (§1). Each shape is also served by a hand-written `Bun.serve` that writes the SAME bytes
// with the same flush pattern, in this process, timed by this loop. Absolute ms describe the machine;
// the ratio describes the framework. Note it is not equivalent for the streamed shape — the baseline
// knows the payload up front and abide discovers it — so read that row's absolute, not its ratio.

import { GET } from 'abide/server/GET'
import { createTestApp, type TestApp } from 'abide/test/createTestApp'
import { benchSelection } from './src/benchSelection.ts'

// Enough samples to give p99 meaning without turning a bench run into a coffee break; the whole point
// is the tail, and a 40-sample p99 is one observation.
const SAMPLES = Number(process.env.ABIDE_DOC_BENCH_SAMPLES ?? 400)
const WARMUP = 25
// A wall ceiling per shape, like every other abide bench: a streamed shape is bounded by its own read,
// so a slow one must not silently turn 400 samples into minutes.
const WALL_CEILING_MS = Number(process.env.ABIDE_DOC_BENCH_WALL ?? 20_000)

interface Sample {
    ttfb: number
    complete: number
    boot: number
}

interface Shape {
    label: string
    note: string
    path: string
}

interface Stats {
    p50: number
    p90: number
    p99: number
    max: number
}

function stats(values: number[]): Stats {
    const sorted = [...values].sort((a, b) => a - b)
    const at = (p: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
    return { p50: at(0.5), p90: at(0.9), p99: at(0.99), max: sorted[sorted.length - 1] ?? 0 }
}

// The boot entry's URL, as the document spells it. Located by scanning the bytes AS THEY ARRIVE rather
// than by parsing the finished document — the whole question is at which byte a browser could first act
// on it, which a completed-document search cannot answer.
const BOOT_HREF = /\/__abide\/chunk\/loader-[a-z0-9]+\.js/

async function sampleOnce(url: string): Promise<Sample> {
    const started = performance.now()
    const response = await fetch(url, { headers: { 'accept-encoding': 'identity' } })
    const body = response.body
    if (body === null) throw new Error(`no body from ${url}`)
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let ttfb = 0
    let boot = 0
    let seen = ''
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const now = performance.now() - started
        if (ttfb === 0) ttfb = now
        if (boot === 0) {
            // Only the unmatched remainder needs re-scanning, but a document is small and the scan is
            // untimed relative to the network read; correctness over cleverness here.
            seen += decoder.decode(value, { stream: true })
            if (BOOT_HREF.test(seen)) boot = now
        }
    }
    const complete = performance.now() - started
    // A document that boots no client (the byte-oracle shapes) reports its boot at completion rather
    // than 0, so the coupling ratio stays meaningful instead of dividing by a sentinel.
    return { ttfb, complete, boot: boot === 0 ? complete : boot }
}

async function sampleShape(url: string): Promise<Sample[]> {
    for (let i = 0; i < WARMUP; i++) await sampleOnce(url)
    const samples: Sample[] = []
    const deadline = performance.now() + WALL_CEILING_MS
    for (let i = 0; i < SAMPLES; i++) {
        samples.push(await sampleOnce(url))
        if (performance.now() > deadline) {
            // Never cap coverage silently (§8) — say how much was dropped, on stderr so `--json` stays clean.
            process.stderr.write(
                `  ! wall ceiling hit after ${samples.length}/${SAMPLES} samples (${WALL_CEILING_MS}ms)\n`,
            )
            break
        }
    }
    return samples
}

// The shapes. Each exists because it distinguishes something the others cannot.
const SHAPES: Shape[] = [
    {
        label: 'doc/static',
        note: 'no reads — the floor; ttfb and complete coincide',
        path: '/static',
    },
    {
        label: 'doc/inline-read',
        note: 'a read that settles inside the SSR deadline (renders inline)',
        path: '/inline',
    },
    {
        label: 'doc/streamed-read',
        note: 'a read that misses the deadline — the shape that distinguishes boot from complete',
        path: '/streamed',
    },
]

const SLOW_READ_MS = 40

async function buildApp(): Promise<TestApp> {
    return createTestApp({
        routes: {
            fast: GET(() => 'inline'),
            slow: GET(async () => {
                await Bun.sleep(SLOW_READ_MS)
                return 'streamed'
            }),
        },
        pages: {
            '/static': '<main><h1>static</h1><p>no reads at all</p></main>',
            '/inline':
                "<script>import fast from 'abide-rpc:fast'</script><main><p>{await fast()}</p></main>",
            '/streamed':
                "<script>import slow from 'abide-rpc:slow'</script><main>{#await slow()}<i>pending</i>{:then v}<p>{v}</p>{/await}</main>",
        },
    })
}

// The hand-written baseline (§1): the same bytes, the same flush pattern, no framework. For the
// streamed shape that means head+shell now and the rest after the same delay — which is what abide's
// transport does, though the baseline knows the answer in advance and abide discovers it.
function serveBaseline(bodies: Map<string, { head: string; tail: string; delayMs: number }>) {
    return Bun.serve({
        port: 0,
        fetch(request) {
            const path = new URL(request.url).pathname
            const shape = bodies.get(path)
            if (shape === undefined) return new Response('not found', { status: 404 })
            const encoder = new TextEncoder()
            return new Response(
                new ReadableStream<Uint8Array>({
                    async start(controller) {
                        controller.enqueue(encoder.encode(shape.head))
                        if (shape.delayMs > 0) await Bun.sleep(shape.delayMs)
                        controller.enqueue(encoder.encode(shape.tail))
                        controller.close()
                    },
                }),
                { headers: { 'content-type': 'text/html; charset=utf-8' } },
            )
        },
    })
}

const selection = benchSelection(process.argv.slice(2), { positional: true })
const asJson = process.argv.includes('--json')

if (selection.list) {
    for (const shape of SHAPES) console.log(shape.label)
    process.exit(0)
}

const chosen = SHAPES.filter((shape) => selection.matches(shape.label))
const unmatched = selection.unmatched(SHAPES.map((shape) => shape.label))
if (unmatched.length > 0) {
    process.stderr.write(`no document shape matches: ${unmatched.join(', ')}\n`)
    process.exit(1)
}

const app = await buildApp()

// Capture each shape's real document once, so the baseline replays byte-identical output.
const baselineBodies = new Map<string, { head: string; tail: string; delayMs: number }>()
for (const shape of chosen) {
    const html = await (await fetch(app.origin + shape.path)).text()
    const split = html.indexOf('</div>')
    baselineBodies.set(shape.path, {
        head: html.slice(0, split),
        tail: html.slice(split),
        delayMs: shape.path === '/streamed' ? SLOW_READ_MS : 0,
    })
}
const baseline = serveBaseline(baselineBodies)

interface Row {
    label: string
    note: string
    abide: { ttfb: Stats; complete: Stats; boot: Stats }
    vanilla: { ttfb: Stats; complete: Stats }
    coupling: number
}

const rows: Row[] = []
for (const shape of chosen) {
    const mine = await sampleShape(app.origin + shape.path)
    const theirs = await sampleShape(`http://localhost:${baseline.port}${shape.path}`)
    const boot = stats(mine.map((s) => s.boot))
    const ttfb = stats(mine.map((s) => s.ttfb))
    rows.push({
        label: shape.label,
        note: shape.note,
        abide: { ttfb, complete: stats(mine.map((s) => s.complete)), boot },
        vanilla: {
            ttfb: stats(theirs.map((s) => s.ttfb)),
            complete: stats(theirs.map((s) => s.complete)),
        },
        coupling: ttfb.p50 === 0 ? 1 : boot.p50 / ttfb.p50,
    })
}

baseline.stop(true)
await app.stop()

if (asJson) {
    console.log(JSON.stringify({ time: Date.now(), samples: SAMPLES, rows }, null, 2))
} else {
    const ms = (n: number) => `${n.toFixed(2)}ms`
    const pad = (s: string, n: number) => s.padEnd(n)
    console.log(
        `\n${pad('shape', 20)}${pad('metric', 10)}${pad('p50', 10)}${pad('p90', 10)}${pad('p99', 10)}${pad('max', 10)}${pad('vanilla p50', 12)}`,
    )
    console.log('─'.repeat(82))
    for (const row of rows) {
        console.log(
            `${pad(row.label, 20)}${pad('ttfb', 10)}${pad(ms(row.abide.ttfb.p50), 10)}${pad(ms(row.abide.ttfb.p90), 10)}${pad(ms(row.abide.ttfb.p99), 10)}${pad(ms(row.abide.ttfb.max), 10)}${pad(ms(row.vanilla.ttfb.p50), 12)}`,
        )
        console.log(
            `${pad('', 20)}${pad('complete', 10)}${pad(ms(row.abide.complete.p50), 10)}${pad(ms(row.abide.complete.p90), 10)}${pad(ms(row.abide.complete.p99), 10)}${pad(ms(row.abide.complete.max), 10)}${pad(ms(row.vanilla.complete.p50), 12)}`,
        )
        console.log(
            `${pad('', 20)}${pad('boot', 10)}${pad(ms(row.abide.boot.p50), 10)}${pad(ms(row.abide.boot.p90), 10)}${pad(ms(row.abide.boot.p99), 10)}${pad(ms(row.abide.boot.max), 10)}`,
        )
        console.log(
            `${pad('', 20)}coupling boot÷ttfb = ${row.coupling.toFixed(2)}×  — ${row.note}\n`,
        )
    }
    console.log(
        'coupling 1.0 = the client bundle starts downloading independently of how long this page reads.\n',
    )
}
