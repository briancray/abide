<script lang="ts">
import { HttpError } from 'belte/shared/HttpError'
import { getEcho } from '$rpc/getEcho.ts'
import { createEcho } from '$rpc/createEcho.ts'
import { replaceEcho } from '$rpc/replaceEcho.ts'
import { patchEcho } from '$rpc/patchEcho.ts'
import { deleteEcho } from '$rpc/deleteEcho.ts'
import { headEcho } from '$rpc/headEcho.ts'

type EchoCall = { verb: string; outcome: string }
let log = $state<EchoCall[]>([])

function record(verb: string, outcome: string) {
    log = [...log, { verb, outcome }].slice(-12)
}

async function safeCall(verb: string, fn: () => Promise<unknown>): Promise<void> {
    try {
        const value = await fn()
        record(verb, value === undefined ? '(no body)' : JSON.stringify(value))
    } catch (err) {
        const status = err instanceof HttpError ? `${err.status} ${err.statusText}` : String(err)
        record(verb, `error: ${status}`)
    }
}

const message = $state({ value: 'hello' })
</script>

<h1 class="text-3xl font-bold">Verb-bound rpcs</h1>
<p class="mt-2 text-slate-600">
    Each file under <code class="font-mono">src/rpc/</code> declares exactly one remote function.
    The imported verb picks the HTTP method; the filename picks the URL. The same identifier
    is the typed callable on both sides.
</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <label class="text-sm font-medium">
        Message
        <input
            bind:value={message.value}
            class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
    </label>
    <div class="mt-4 flex flex-wrap gap-2">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={() => safeCall('GET', () => getEcho({ message: message.value }))}>
            GET getEcho
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={() => safeCall('POST', () => createEcho({ message: message.value }))}>
            POST createEcho
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={() => safeCall('PUT', () => replaceEcho({ message: message.value }))}>
            PUT replaceEcho
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={() => safeCall('PATCH', () => patchEcho({ message: message.value }))}>
            PATCH patchEcho
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={() => safeCall('DELETE', () => deleteEcho({ message: message.value }))}>
            DELETE deleteEcho
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={() => safeCall('HEAD', () => headEcho())}>
            HEAD headEcho
        </button>
    </div>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Outcome log</h2>
    {#if log.length === 0}
        <p class="mt-2 text-sm text-slate-500">(no calls yet)</p>
    {:else}
        <ul class="mt-2 space-y-1 font-mono text-sm text-slate-700">
            {#each log as entry, i (i)}
                <li>{entry.verb} → {entry.outcome}</li>
            {/each}
        </ul>
    {/if}
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
    <p>
        Each remote function also exposes <code class="font-mono">.url</code>
        and <code class="font-mono">.method</code>, so plain HTML works too:
    </p>
    <form
        method="POST"
        action={createEcho.url}
        target="_blank"
        class="mt-3 flex flex-wrap items-center gap-2">
        <input
            name="message"
            value="form post"
            class="rounded-md border border-slate-300 px-3 py-1 text-sm" />
        <button
            type="submit"
            class="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100">
            Submit <code class="font-mono">POST {createEcho.url}</code>
        </button>
    </form>
</section>
