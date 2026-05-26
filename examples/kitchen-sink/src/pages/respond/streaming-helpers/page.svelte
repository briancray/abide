<script lang="ts">
import CodeBlock from '$lib/CodeBlock.svelte'
import { tickFeed } from '$route/tickFeed.ts'
import { countLog } from '$route/countLog.ts'

let sseFrames = $state<string[]>([])
let jsonlFrames = $state<string[]>([])

/*
SSE consumption via native EventSource — `tickFeed.url` is the same
flat HTTP route the bundler produced. `tickFeed.raw(...)` would also
work if you wanted Response headers/status alongside the body; for a
quick subscribe, EventSource is shorter.
*/
function runSse() {
    sseFrames = []
    const source = new EventSource(tickFeed.url)
    source.addEventListener('message', (event) => {
        sseFrames = [...sseFrames, event.data]
        if (sseFrames.length >= 5) {
            source.close()
        }
    })
}

/*
JSONL consumption via `.raw(args)` so we have a Response to iterate.
TextDecoderStream + a split-by-newline reduce turns the body chunks
into one JSON object per line.
*/
async function runJsonl() {
    jsonlFrames = []
    const response = await countLog.raw({ to: 8 })
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += value
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
            if (line) jsonlFrames = [...jsonlFrames, line]
        }
    }
}
</script>

<h1 class="text-3xl font-bold">Streaming over HTTP</h1>
<p class="mt-2 text-slate-600">
    Wrap an <code class="font-mono">AsyncIterable</code>
    in <code class="font-mono">sse(...)</code>
    or <code class="font-mono">jsonl(...)</code>
    inside a verb-bound handler and the response becomes a stream. Consume client-side with
    native browser APIs — <code class="font-mono">EventSource</code>
    for SSE, <code class="font-mono">fetch().body</code> via the
    <code class="font-mono">.raw</code> escape hatch for JSONL. For
    fan-out/pub-sub use a <a class="underline" href="/stream">Stream</a> instead — that's
    what <code class="font-mono">subscribe()</code> consumes.
</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold"><code class="font-mono">sse</code> — text/event-stream</h2>
    <p class="mt-1 text-sm text-slate-600">
        <code class="font-mono">tickFeed</code>
        yields a timestamp every second; this button reads 5 frames then closes the
        EventSource. Closing the connection propagates back through the ReadableStream's
        <code class="font-mono">cancel</code>
        into the handler's iterator <code class="font-mono">return()</code>.
    </p>
    <button
        type="button"
        class="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        onclick={runSse}>
        run tickFeed (5 frames)
    </button>
    <ul class="mt-3 space-y-1 font-mono text-xs text-slate-700">
        {#each sseFrames as frame, i (i)}
            <li>{frame}</li>
        {/each}
    </ul>
    <CodeBlock
        title="src/route/tickFeed.ts (server)"
        code={`import { GET } from 'belte/route'
import { sse } from 'belte/respond'

export const tickFeed = GET(() =>
    sse(
        (async function* () {
            for (let tick = 1; ; tick += 1) {
                yield { tick, at: new Date().toISOString() }
                await Bun.sleep(1000)
            }
        })(),
    ),
)`} />
    <CodeBlock
        title="this page (client)"
        code={`import { tickFeed } from '$route/tickFeed.ts'

const source = new EventSource(tickFeed.url)
source.addEventListener('message', (event) => {
    /* event.data is the JSON-stringified frame the sse() helper sent */
    if (++received >= 5) source.close()
})`} />
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold"><code class="font-mono">jsonl</code> — application/jsonl</h2>
    <p class="mt-1 text-sm text-slate-600">
        <code class="font-mono">countLog({`{ to: 8 }`})</code>
        yields <code class="font-mono">{`{ n: 1 }`}</code> through
        <code class="font-mono">{`{ n: 8 }`}</code>, one JSON object per line. Consume via
        <code class="font-mono">.raw(args)</code>
        and a <code class="font-mono">ReadableStream</code> reader.
    </p>
    <button
        type="button"
        class="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        onclick={runJsonl}>
        run countLog
    </button>
    <ul class="mt-3 space-y-1 font-mono text-xs text-slate-700">
        {#each jsonlFrames as frame, i (i)}
            <li>{frame}</li>
        {/each}
    </ul>
    <CodeBlock
        title="src/route/countLog.ts (server)"
        code={`import { GET } from 'belte/route'
import { jsonl } from 'belte/respond'

export const countLog = GET<{ to: number }>(({ to }) =>
    jsonl(
        (async function* () {
            for (let n = 1; n <= to; n += 1) {
                yield { n }
                await Bun.sleep(200)
            }
        })(),
    ),
)`} />
    <CodeBlock
        title="this page (client)"
        code={`import { countLog } from '$route/countLog.ts'

const response = await countLog.raw({ to: 8 })
const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
/* split-by-newline reduce yields one JSON object per line */`} />
</section>
