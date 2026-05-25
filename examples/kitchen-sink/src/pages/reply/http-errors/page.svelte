<script lang="ts">
import { HttpError } from 'belte/shared/HttpError'
import { getProduct } from '$rpc/getProduct.ts'
import { boom } from '$rpc/boom.ts'
import { getEcho } from '$rpc/getEcho.ts'

type Outcome = { label: string; line: string }
let log = $state<Outcome[]>([])

function record(label: string, line: string) {
    log = [...log, { label, line }].slice(-12)
}

async function trigger404() {
    try {
        await getProduct({ id: 'missing' })
        record('404', '(no error?)')
    } catch (err) {
        if (err instanceof HttpError) {
            record('404', `caught HttpError(${err.status}) — Cache-Control: ${err.response.headers.get('cache-control')}`)
        } else {
            record('404', String(err))
        }
    }
}

async function trigger405() {
    /*
    POST to a GET-only rpc — framework returns 405 with an Allow header.
    Using plain fetch so we can inspect the headers ourselves.
    */
    const response = await fetch(getEcho.url, { method: 'POST' })
    record('405', `status=${response.status} Allow=${response.headers.get('allow')}`)
}

async function trigger500() {
    try {
        await boom()
        record('500', '(no error?)')
    } catch (err) {
        const status = err instanceof HttpError ? err.status : 'unknown'
        record('500', `caught HttpError(${status})`)
    }
}
</script>

<h1 class="text-3xl font-bold">HTTP errors</h1>
<p class="mt-2 text-slate-600">
    Non-2xx responses come back through the same call site as the success path. Direct calls
    throw <code class="font-mono">HttpError</code>
    with <code class="font-mono">status</code>, <code class="font-mono">statusText</code>, and
    the raw <code class="font-mono">response</code>. The framework sets
    <code class="font-mono">Cache-Control: no-store</code>
    on every error response, and 405s carry an
    <code class="font-mono">Allow</code> header.
</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <div class="flex flex-wrap gap-2 text-sm">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={trigger404}>
            getProduct({`{ id: 'missing' }`}) → 404
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={trigger405}>
            POST /rpc/getEcho → 405
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={trigger500}>
            boom() → 500
        </button>
    </div>
    {#if log.length > 0}
        <ul class="mt-3 space-y-1 font-mono text-xs text-slate-700">
            {#each log as entry, i (i)}
                <li><strong>{entry.label}</strong> — {entry.line}</li>
            {/each}
        </ul>
    {/if}
</section>
