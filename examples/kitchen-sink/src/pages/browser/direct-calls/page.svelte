<script lang="ts">
import CodeBlock from '$lib/CodeBlock.svelte'
import { getEcho } from '$rpc/getEcho.ts'
import { createEcho } from '$rpc/createEcho.ts'

let remoteBody = $state('(not called)')
let plainBody = $state('(not called)')

async function callRemote() {
    const value = await getEcho({ message: 'from remote proxy' })
    remoteBody = JSON.stringify(value)
}

async function callPlainFetch() {
    const url = `${getEcho.url}?message=${encodeURIComponent('from plain fetch')}`
    const response = await fetch(url)
    plainBody = `status=${response.status} body=${await response.text()}`
}
</script>

<h1 class="text-3xl font-bold">Direct calls</h1>
<p class="mt-2 text-slate-600">
    The function returned by <code class="font-mono">GET()</code> / <code class="font-mono">POST()</code> / …
    is callable as-is. Server runs the handler in-process; client gets a typed
    <code class="font-mono">fetch</code> to the matching URL.
</p>

<section class="mt-6">
    <h2 class="text-sm font-semibold">Decoded body shape</h2>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-medium">Content-Type</th>
                    <th class="px-4 py-2 font-medium">decoded as</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr><td class="px-4 py-2 font-mono">application/json</td><td class="px-4 py-2 font-mono text-slate-500">object</td></tr>
                <tr><td class="px-4 py-2 font-mono">text/*</td><td class="px-4 py-2 font-mono text-slate-500">string</td></tr>
                <tr><td class="px-4 py-2 text-slate-600">binary</td><td class="px-4 py-2 font-mono text-slate-500">Blob</td></tr>
                <tr><td class="px-4 py-2 font-mono">204 No Content</td><td class="px-4 py-2 font-mono text-slate-500">undefined</td></tr>
            </tbody>
        </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">
        Non-2xx throws <code class="font-mono">HttpError</code>. Need the raw response or to
        stream? See <a class="underline" href="/server/raw-stream">.raw and .stream(args?)</a>.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Try it</h2>
    <div class="mt-3 flex flex-wrap gap-2 text-sm">
        <button type="button" class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100" onclick={callRemote}>
            await getEcho({`{ message: '…' }`})
        </button>
        <button type="button" class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100" onclick={callPlainFetch}>
            fetch(getEcho.url + '?message=…')
        </button>
    </div>
    <ul class="mt-3 space-y-1 font-mono text-xs text-slate-700">
        <li>typed: {remoteBody}</li>
        <li>plain: {plainBody}</li>
    </ul>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Plain HTML form</h2>
    <p class="mt-1 text-xs text-slate-500">
        <code class="font-mono">.url</code> and <code class="font-mono">.method</code> make
        forms first-class — no JS required.
    </p>
    <form
        action={createEcho.url}
        method={createEcho.method}
        target="_blank"
        class="mt-3 flex flex-wrap items-center gap-2">
        <input
            name="message"
            value="from plain form"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
        <button type="submit" class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">
            <code class="font-mono">{createEcho.method} {createEcho.url}</code>
        </button>
    </form>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="src/server/rpc/getEcho.ts"
        code={`import { GET, json } from 'belte/server'

export const getEcho = GET<{ message: string }>(({ message }) =>
    json({ method: 'GET' as const, message }),
)`} />

    <CodeBlock
        title="client — three flavours, same rpc"
        code={`import { getEcho } from '$rpc/getEcho.ts'
import { createEcho } from '$rpc/createEcho.ts'

// 1. typed callable — bundler swaps runtime per build target
const value = await getEcho({ message: 'hi' })

// 2. plain fetch via .url
const response = await fetch(\`\${getEcho.url}?message=hi\`)

// 3. HTML form via .url + .method
// <form action={createEcho.url} method={createEcho.method}>…</form>`} />
</section>
