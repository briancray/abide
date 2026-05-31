<script lang="ts">
import { HttpError } from '@briancray/belte/browser/HttpError'
import CodeBlock from '$browser/CodeBlock.svelte'
import { createEcho } from '$server/rpc/createEcho.ts'
import { deleteEcho } from '$server/rpc/deleteEcho.ts'
import { getEcho } from '$server/rpc/getEcho.ts'
import { headEcho } from '$server/rpc/headEcho.ts'
import { patchEcho } from '$server/rpc/patchEcho.ts'
import { replaceEcho } from '$server/rpc/replaceEcho.ts'

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

<nav class="mb-2 text-sm text-slate-500">
    <a href="/server" class="hover:text-slate-900"><code class="font-mono">belte/server</code></a>
    <span class="mx-2">/</span>
    <span>RPC</span>
</nav>
<h1 class="text-3xl font-bold">RPC</h1>
<p class="mt-2 text-slate-600">
    One file per rpc under <code class="font-mono">src/server/rpc/</code>
    . Filename = export name = URL path under <code class="font-mono">/rpc/</code>
    ; the imported verb picks the HTTP method.
</p>

<section class="mt-6">
    <h2 class="text-sm font-semibold">Args parsing</h2>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">verb</th>
                    <th class="px-4 py-2 font-medium">args from</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">GET / DELETE / HEAD</td>
                    <td class="px-4 py-2 text-slate-600">URL search params</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">POST / PUT / PATCH</td>
                    <td class="px-4 py-2 text-slate-600">
                        JSON body or <code class="font-mono">FormData</code> (query overrides)
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
    <ul class="mt-2 space-y-1 text-xs text-slate-500">
        <li>
            URLs are flat — no <code class="font-mono">[id]</code> segments. Pass identifiers via
            args.
        </li>
        <li>
            Wrong verb on a known URL → <code class="font-mono">405</code> with <code
                class="font-mono">
                Allow
            </code> header.
        </li>
        <li>
            Dynamic page segments (e.g. <a class="underline" href="/server/rpc/product/1">
                /product/1
            </a>
            ) are a page-tree feature; rpcs stay flat.
        </li>
    </ul>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Try every verb</h2>
    <label class="mt-2 block text-xs font-medium">
        message
        <input
            bind:value={message.value}
            class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm">
    </label>
    <div class="mt-3 flex flex-wrap gap-2 text-sm">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => safeCall('GET', () => getEcho({ message: message.value }))}>
            GET
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => safeCall('POST', () => createEcho({ message: message.value }))}>
            POST
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => safeCall('PUT', () => replaceEcho({ message: message.value }))}>
            PUT
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => safeCall('PATCH', () => patchEcho({ message: message.value }))}>
            PATCH
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => safeCall('DELETE', () => deleteEcho({ message: message.value }))}>
            DELETE
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => safeCall('HEAD', () => headEcho())}>
            HEAD
        </button>
    </div>
    {#if log.length > 0}
        <ul class="mt-3 space-y-1 font-mono text-xs text-slate-700">
            {#each log as entry, i (i)}
                <li>{entry.verb} → {entry.outcome}</li>
            {/each}
        </ul>
    {/if}
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
    <h2 class="text-sm font-semibold text-slate-900">Plain HTML works too</h2>
    <p class="mt-1 text-xs text-slate-500">
        Each rpc exposes <code class="font-mono">.url</code> and <code class="font-mono">
            .method
        </code>
        .
    </p>
    <form
        action={createEcho.url}
        method={createEcho.method}
        target="_blank"
        class="mt-3 flex flex-wrap items-center gap-2">
        <input
            name="message"
            value="form post"
            class="rounded-md border border-slate-300 px-3 py-1 text-sm">
        <button
            type="submit"
            class="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100">
            <code class="font-mono">{createEcho.method} {createEcho.url}</code>
        </button>
    </form>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="src/server/rpc/*.ts — one verb per file"
        code={`// getEcho.ts — inputSchema validates args and exposes the rpc to MCP + CLI
import { GET } from '@briancray/belte/server/GET'
import { json } from '@briancray/belte/server/json'
import { z } from 'zod'
const inputSchema = z.object({ message: z.string() })
export const getEcho = GET(({ message }) =>
    json({ method: 'GET' as const, message }), { inputSchema })

// createEcho.ts — POST: args from JSON body
export const createEcho = POST<{ message: string }>(({ message }) =>
    json({ method: 'POST' as const, message }, { status: 201 }),
)

// headEcho.ts — HEAD: response carries headers, no body
export const headEcho = HEAD(() =>
    new Response(undefined, { status: 204, headers: { 'x-echo': 'HEAD' } }),
)`} />

    <CodeBlock
        title="client — same call shape per verb"
        code={`await getEcho({ message: 'hello' })       // typed { method: 'GET'; message: string }
await createEcho({ message: 'hello' })    // typed { method: 'POST'; message: string }
// HEAD resolves to undefined; the rest resolve to the decoded JSON body`} />
</section>
