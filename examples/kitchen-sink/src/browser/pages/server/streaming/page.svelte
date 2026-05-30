<script lang="ts">
import CodeBlock from '$browser/CodeBlock.svelte'
import { tickFeed } from '$server/rpc/tickFeed.ts'
import { countLog } from '$server/rpc/countLog.ts'

let sseFrames = $state<string[]>([])
let jsonlFrames = $state<string[]>([])

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

<nav class="mb-2 text-sm text-slate-500">
    <a href="/server" class="hover:text-slate-900"><code class="font-mono">belte/server</code></a>
    <span class="mx-2">/</span>
    <span>Streaming over HTTP</span>
</nav>
<h1 class="text-3xl font-bold">Streaming over HTTP</h1>
<p class="mt-2 text-slate-600">
    Wrap an <code class="font-mono">AsyncIterable</code> in
    <code class="font-mono">sse()</code> or <code class="font-mono">jsonl()</code>;
    consume client-side with native APIs.
</p>

<section class="mt-6">
    <h2 class="text-sm font-semibold">The two helpers</h2>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">helper</th>
                    <th class="px-4 py-2 font-medium">content-type</th>
                    <th class="px-4 py-2 font-medium">client consumer</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">sse</td>
                    <td class="px-4 py-2 font-mono text-slate-500">text/event-stream</td>
                    <td class="px-4 py-2 text-slate-600"><code class="font-mono">new EventSource(fn.url)</code></td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">jsonl</td>
                    <td class="px-4 py-2 font-mono text-slate-500">application/jsonl</td>
                    <td class="px-4 py-2 text-slate-600"><code class="font-mono">fn.raw(args).then(r =&gt; r.body)</code></td>
                </tr>
            </tbody>
        </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">
        Consumer cancellation propagates to <code class="font-mono">iterator.return()</code>
        — handler <code class="font-mono">finally</code> blocks run. For fan-out pub/sub use
        <a class="underline" href="/server/sockets">Sockets</a> instead.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">SSE — try it</h2>
    <button
        type="button"
        class="mt-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        onclick={runSse}>
        run tickFeed (close after 5 frames)
    </button>
    {#if sseFrames.length > 0}
        <ul class="mt-3 space-y-1 font-mono text-xs text-slate-700">
            {#each sseFrames as frame, i (i)}<li>{frame}</li>{/each}
        </ul>
    {/if}
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">JSONL — try it</h2>
    <button
        type="button"
        class="mt-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        onclick={runJsonl}>
        run countLog({`{ to: 8 }`})
    </button>
    {#if jsonlFrames.length > 0}
        <ul class="mt-3 space-y-1 font-mono text-xs text-slate-700">
            {#each jsonlFrames as frame, i (i)}<li>{frame}</li>{/each}
        </ul>
    {/if}
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="src/server/rpc/tickFeed.ts — SSE"
        code={`import { GET } from '@briancray/belte/server/GET'
import { sse } from '@briancray/belte/server/sse'

export const tickFeed = GET(() =>
    sse((async function* () {
        for (let tick = 1; ; tick += 1) {
            yield { tick, at: new Date().toISOString() }
            await Bun.sleep(1000)
        }
    })()),
)`} />

    <CodeBlock
        title="src/server/rpc/countLog.ts — JSONL"
        code={`import { GET } from '@briancray/belte/server/GET'
import { jsonl } from '@briancray/belte/server/jsonl'

export const countLog = GET<{ to: number }>(({ to }) =>
    jsonl((async function* () {
        for (let n = 1; n <= to; n += 1) {
            yield { n }
            await Bun.sleep(200)
        }
    })()),
)`} />

    <CodeBlock
        title="client — native consumers"
        code={`// SSE
const source = new EventSource(tickFeed.url)
source.addEventListener('message', (event) => { /* event.data is the JSON-stringified frame */ })

// JSONL
const response = await countLog.raw({ to: 8 })
const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
// split-by-newline reduce yields one JSON object per line`} />
</section>
