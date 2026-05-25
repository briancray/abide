<script lang="ts">
import { cache } from 'belte/consume'
import { getReport } from '$route/getReport.ts'

let decoded = $state('(not called)')
let raw = $state('(not called)')

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

/*
.raw composes with cache() the same way the decoded variant does. Both
share one stored entry by method + url + args — the difference is only
what the invoker hands back.
*/
const cachedRaw = $derived(cache(getReport.raw)({ id: 'r-1' }))
</script>

<h1 class="text-3xl font-bold"><code class="font-mono">.raw</code> escape hatch</h1>
<p class="mt-2 text-slate-600">
    Every remote function has a
    <code class="font-mono">.raw</code> sibling whose call resolves to the underlying
    <code class="font-mono">Response</code>
    instead of the decoded body. Reach for it when you need headers, status, or to stream
    the body yourself.
</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Decoded vs raw</h2>
    <div class="mt-3 flex flex-wrap gap-2 text-sm">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={readDecoded}>
            await getReport({`{ id: 'r-1' }`})
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={readRaw}>
            await getReport.raw({`{ id: 'r-1' }`})
        </button>
    </div>
    <p class="mt-3 font-mono text-xs text-slate-700">decoded: {decoded}</p>
    <p class="mt-1 font-mono text-xs text-slate-700">raw: {raw}</p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Composes with cache()</h2>
    <p class="mt-1 text-sm text-slate-600">
        Pass <code class="font-mono">fn.raw</code>
        to <code class="font-mono">cache()</code>
        and the invoker returns
        <code class="font-mono">Promise&lt;Response&gt;</code>; entries are keyed by
        method + url + args so the decoded and raw variants share one store.
    </p>
    {#await cachedRaw}
        <p class="mt-3 font-mono text-xs text-slate-500">…</p>
    {:then response}
        <p class="mt-3 font-mono text-xs text-slate-700">
            cached raw → status={response.status} x-report-version={response.headers.get('x-report-version')}
        </p>
    {/await}
</section>
