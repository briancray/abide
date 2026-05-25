<script lang="ts">
import { tickFeed } from '$route/tickFeed.ts'
import { countLog } from '$route/countLog.ts'

let sseFrames = $state<string[]>([])
let jsonlFrames = $state<string[]>([])

async function runSse() {
    sseFrames = []
    let received = 0
    for await (const frame of tickFeed.stream()) {
        sseFrames = [...sseFrames, JSON.stringify(frame)]
        received += 1
        if (received === 5) {
            break  /* iterator.return() fires → server stops generating */
        }
    }
}

async function runJsonl() {
    jsonlFrames = []
    for await (const frame of countLog.stream({ to: 8 })) {
        jsonlFrames = [...jsonlFrames, JSON.stringify(frame)]
    }
}
</script>

<h1 class="text-3xl font-bold">Streaming over HTTP</h1>
<p class="mt-2 text-slate-600">
    Wrap an <code class="font-mono">AsyncIterable</code>
    in <code class="font-mono">sse(...)</code>
    or <code class="font-mono">jsonl(...)</code>
    inside a verb-bound handler and the response becomes a stream. Consumers iterate via
    <code class="font-mono">fn.stream(args)</code>
    or reactively via <code class="font-mono">subscribe(fn)(args)</code>.
</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold"><code class="font-mono">sse</code> — text/event-stream</h2>
    <p class="mt-1 text-sm text-slate-600">
        <code class="font-mono">tickFeed</code>
        yields a timestamp every second; this button drains 5 frames then breaks (the
        iterator's <code class="font-mono">return()</code> propagates back into the handler's
        <code class="font-mono">for await</code> and exits the generator).
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
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold"><code class="font-mono">jsonl</code> — application/jsonl</h2>
    <p class="mt-1 text-sm text-slate-600">
        <code class="font-mono">countLog({`{ to: 8 }`})</code>
        yields <code class="font-mono">{`{ n: 1 }`}</code> through
        <code class="font-mono">{`{ n: 8 }`}</code>, one JSON object per line.
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
</section>
