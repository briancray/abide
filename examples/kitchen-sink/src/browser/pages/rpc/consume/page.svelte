<script lang="ts">
import { cache } from '@belte/belte/shared/cache'
import CodeBlock from '$browser/CodeBlock.svelte'
import RpcHeader from '$browser/RpcHeader.svelte'
import { createEcho } from '$server/rpc/createEcho.ts'
import { getEcho } from '$server/rpc/getEcho.ts'
import { getReport } from '$server/rpc/getReport.ts'
import { tickFeed } from '$server/rpc/tickFeed.ts'

let decoded = $state('(not called)')
let raw = $state('(not called)')
let plainBody = $state('(not called)')
let streamFrames = $state<string[]>([])

async function readDecoded() {
    const body = await getEcho({ message: 'hello' })
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

async function callPlainFetch() {
    const url = `${getEcho.url}?message=${encodeURIComponent('from plain fetch')}`
    const response = await fetch(url)
    plainBody = `status=${response.status} body=${await response.text()}`
}

const cachedRaw = $derived(cache(getReport.raw)({ id: 'r-1' }))
</script>

<RpcHeader />
<h1 class="mt-8 text-3xl font-bold">Consume — same import everywhere</h1>
<p class="mt-2 text-slate-600">
    The function returned by <code class="font-mono">GET()</code> /
    <code class="font-mono">POST()</code>
    / … is callable as-is: the server runs the handler in-process, the browser bundle swaps in a
    typed <code class="font-mono">fetch</code>
    to the matching URL. Two function-shape siblings ride along.
</p>

<section class="mt-6">
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">form</th>
                    <th class="px-4 py-2 font-medium">resolves to</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">fn(args)</td>
                    <td class="px-4 py-2 text-slate-600">
                        decoded body; throws
                        <a class="underline" href="/rpc/errors">
                            <code class="font-mono">HttpError</code>
                        </a>
                        (<code class="font-mono">status</code>,
                        <code class="font-mono">response</code>) on non-2xx
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">fn.raw(args)</td>
                    <td class="px-4 py-2 text-slate-600">
                        the raw <code class="font-mono">Response</code> — headers, status, streaming
                        body
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">fn.stream(args)</td>
                    <td class="px-4 py-2 text-slate-600">
                        a <code class="font-mono">Subscribable</code> over the frames — feed to
                        <a class="underline" href="/tail"><code class="font-mono">tail()</code></a>
                        or iterate with <code class="font-mono">for await</code>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">
        Decoding follows Content-Type: <code class="font-mono">application/json</code> → object,
        <code class="font-mono">text/*</code>
        → string, binary → <code class="font-mono">Blob</code>,
        <code class="font-mono">204</code>
        → undefined.
        <code class="font-mono">cache(fn.raw)</code>
        shares the same key as <code class="font-mono">cache(fn)</code> — both variants live in one
        stored entry.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Try it</h2>
    <div class="mt-3 flex flex-wrap gap-2 text-sm">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={readDecoded}>
            await getEcho({`{ message: 'hello' }`}
            )
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={readRaw}>
            await getReport.raw({`{ id: 'r-1' }`}
            )
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={readStream}>
            for await tickFeed.stream() (3 frames)
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={callPlainFetch}>
            fetch(getEcho.url + '?message=…')
        </button>
    </div>
    <ul class="mt-3 space-y-1 font-mono text-xs text-slate-700">
        <li>decoded:{decoded}</li>
        <li>raw:{raw}</li>
        <li>plain:{plainBody}</li>
        {#each streamFrames as f, i (i)}
            <li>stream[{i}]:{f}</li>
        {/each}
    </ul>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold"><code class="font-mono">cache(fn.raw)</code></h2>
    {#await cachedRaw}
        <p class="mt-2 font-mono text-xs text-slate-500">…</p>
    {:then response}
        <p class="mt-2 font-mono text-xs text-slate-700">
            cached raw → status={response.status}
            , x-report-version={response.headers.get('x-report-version')}
        </p>
    {/await}
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Plain HTML form</h2>
    <p class="mt-1 text-xs text-slate-500">
        Each rpc exposes <code class="font-mono">.url</code> and
        <code class="font-mono">.method</code>, so forms work with no JS at all.
    </p>
    <form
        action={createEcho.url}
        method={createEcho.method}
        target="_blank"
        class="mt-3 flex flex-wrap items-center gap-2">
        <input
            name="message"
            value="from plain form"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
        <button
            type="submit"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">
            <code class="font-mono">{createEcho.method} {createEcho.url}</code>
        </button>
    </form>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="client — all three forms, same rpc import"
        code={`import { getReport } from '$server/rpc/getReport.ts'
import { tickFeed } from '$server/rpc/tickFeed.ts'

const body = await getReport({ id: 'r-1' })            // decoded body, HttpError on non-2xx
const response = await getReport.raw({ id: 'r-1' })    // full Response
const version = response.headers.get('x-report-version')

for await (const frame of tickFeed.stream()) { /* iterate jsonl/sse frames */ }

const cachedRaw = $derived(cache(getReport.raw)({ id: 'r-1' }))  // shared cache key`} />

    <CodeBlock
        title="src/server/rpc/getReport.ts — handler sets a custom header"
        code={`import { GET } from '@belte/belte/server/GET'

export const getReport = GET<{ id: string }, { id: string; rows: number[] }>(({ id }) =>
    Response.json(
        { id, rows: [1, 2, 3] },
        { headers: { 'x-report-version': '7', 'Cache-Control': 'no-store' } },
    ),
)`} />
</section>
