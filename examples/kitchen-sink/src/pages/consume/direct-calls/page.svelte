<script lang="ts">
import { getEcho } from '$route/getEcho.ts'
import { createEcho } from '$route/createEcho.ts'

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
    The function returned by <code class="font-mono">GET()</code>
    / <code class="font-mono">POST()</code>
    / etc. is callable as-is. On the server, the handler runs in-process; on the client, the
    bundler swaps it for a typed <code class="font-mono">fetch</code>
    to the matching URL. Each remote function also exposes
    <code class="font-mono">.url</code> and <code class="font-mono">.method</code>
    so plain HTML and plain <code class="font-mono">fetch</code> work too.
</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Typed callable</h2>
    <button
        type="button"
        class="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        onclick={callRemote}>
        await getEcho({`{ message: 'from remote proxy' }`})
    </button>
    <p class="mt-3 font-mono text-xs text-slate-700">{remoteBody}</p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Plain fetch via <code class="font-mono">.url</code></h2>
    <button
        type="button"
        class="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        onclick={callPlainFetch}>
        fetch(getEcho.url + '?message=...')
    </button>
    <p class="mt-3 font-mono text-xs text-slate-700">{plainBody}</p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Plain HTML form via <code class="font-mono">.url</code></h2>
    <form
        method="POST"
        action={createEcho.url}
        target="_blank"
        class="mt-3 flex flex-wrap items-center gap-2">
        <input
            name="message"
            value="from plain form"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
        <button
            type="submit"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">
            Submit <code class="font-mono">{createEcho.method} {createEcho.url}</code>
        </button>
    </form>
</section>
