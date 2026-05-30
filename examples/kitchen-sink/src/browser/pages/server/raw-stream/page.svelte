<script lang="ts">
import CodeBlock from '$browser/CodeBlock.svelte'
import { cache } from '@briancray/belte/browser/cache'
import { getReport } from '$server/rpc/getReport.ts'
import { tickFeed } from '$server/rpc/tickFeed.ts'

let decoded = $state('(not called)')
let raw = $state('(not called)')
let streamFrames = $state<string[]>([])

async function readDecoded() {
    const body = await getReport({ id: 'r-1' })
    decoded = `body=${JSON.stringify(body)} — no access to headers from here`
}

async function readRaw() {
    const response = await getReport.raw({ id: 'r-1' })
    const version = response.headers.get('x-report-version')
    const body = await response.json()
    raw = `status=${response.status} x-report-version=${version} body=${JSON.stringify(body)}`
}

async function readStream() {
    streamFrames = []
    let count = 0
    for await (const frame of tickFeed.stream()) {
        streamFrames = [...streamFrames, JSON.stringify(frame)]
        if (++count >= 3) break
    }
}

const cachedRaw = $derived(cache(getReport.raw)({ id: 'r-1' }))
</script>

<nav class="mb-2 text-sm text-slate-500">
    <a href="/server" class="hover:text-slate-900"><code class="font-mono">belte/server</code></a>
    <span class="mx-2">/</span>
    <span><code class="font-mono">.raw</code> and <code class="font-mono">.stream(args?)</code></span>
</nav>
<h1 class="text-3xl font-bold"><code class="font-mono">.raw</code> and <code class="font-mono">.stream(args?)</code></h1>
<p class="mt-2 text-slate-600">
    Function-shape siblings on every rpc — same <code class="font-mono">method</code> and
    <code class="font-mono">url</code>, different return shape.
</p>

<section class="mt-6">
    <h2 class="text-sm font-semibold">The two siblings</h2>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">sibling</th>
                    <th class="px-4 py-2 font-medium">returns</th>
                    <th class="px-4 py-2 font-medium">use when</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">fn.raw(args?)</td>
                    <td class="px-4 py-2 font-mono text-slate-500">Promise&lt;Response&gt;</td>
                    <td class="px-4 py-2 text-slate-600">you need headers / status / streaming body</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">fn.stream(args?)</td>
                    <td class="px-4 py-2 font-mono text-slate-500">Subscribable&lt;Return&gt;</td>
                    <td class="px-4 py-2 text-slate-600">iterating SSE/JSONL frames, or piping into <code class="font-mono">subscribe()</code></td>
                </tr>
            </tbody>
        </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">
        <code class="font-mono">cache(fn.raw)</code> shares the same key as
        <code class="font-mono">cache(fn)</code>; both variants live in one stored entry.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Try it</h2>
    <div class="mt-3 flex flex-wrap gap-2 text-sm">
        <button type="button" class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100" onclick={readDecoded}>
            await getReport({`{ id: 'r-1' }`})
        </button>
        <button type="button" class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100" onclick={readRaw}>
            await getReport.raw({`{ id: 'r-1' }`})
        </button>
        <button type="button" class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100" onclick={readStream}>
            for await tickFeed.stream() (3 frames)
        </button>
    </div>
    <ul class="mt-3 space-y-1 font-mono text-xs text-slate-700">
        <li>decoded: {decoded}</li>
        <li>raw: {raw}</li>
        {#each streamFrames as f, i (i)}<li>stream[{i}]: {f}</li>{/each}
    </ul>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold"><code class="font-mono">cache(fn.raw)</code></h2>
    {#await cachedRaw}
        <p class="mt-2 font-mono text-xs text-slate-500">…</p>
    {:then response}
        <p class="mt-2 font-mono text-xs text-slate-700">
            cached raw → status={response.status}, x-report-version={response.headers.get('x-report-version')}
        </p>
    {/await}
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="src/server/rpc/getReport.ts — handler sets a custom header"
        code={`import { GET } from '@briancray/belte/server/GET'

export const getReport = GET<{ id: string }, { id: string; rows: number[] }>(({ id }) =>
    Response.json(
        { id, rows: [1, 2, 3] },
        { headers: { 'x-report-version': '7', 'Cache-Control': 'no-store' } },
    ),
)`} />

    <CodeBlock
        title="client — decoded, raw, and stream"
        code={`const body = await getReport({ id: 'r-1' })                  // just the data
const response = await getReport.raw({ id: 'r-1' })          // full Response
const version = response.headers.get('x-report-version')

for await (const frame of tickFeed.stream()) { /* iterate frames */ }

const cachedRaw = $derived(cache(getReport.raw)({ id: 'r-1' }))  // shared cache key`} />
</section>
