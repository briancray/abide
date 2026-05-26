<script lang="ts">
import CodeBlock from '$lib/CodeBlock.svelte'
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
    <CodeBlock
        title="src/route/getEcho.ts (server)"
        code={`import { GET } from 'belte/route'
import { json } from 'belte/respond'

export const getEcho = GET<{ message: string }>(({ message }) =>
    json({ method: 'GET' as const, message }),
)`} />
    <CodeBlock
        title="this page (client — identical line, different runtime)"
        code={`import { getEcho } from '$route/getEcho.ts'

const value = await getEcho({ message: 'from remote proxy' })
/* on the server: handler runs in-process
   on the client: typed fetch to /route/getEcho?message=...
   resolves to the decoded body — JSON parsed, typed as Return */`} />
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Plain fetch via <code class="font-mono">.url</code></h2>
    <p class="mt-1 text-sm text-slate-600">
        Every remote function exposes <code class="font-mono">.url</code>
        (and <code class="font-mono">.method</code>) so you can talk to it with any HTTP client.
    </p>
    <button
        type="button"
        class="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        onclick={callPlainFetch}>
        fetch(getEcho.url + '?message=...')
    </button>
    <p class="mt-3 font-mono text-xs text-slate-700">{plainBody}</p>
    <CodeBlock
        title="this page (client)"
        code={`import { getEcho } from '$route/getEcho.ts'

const url = \`\${getEcho.url}?message=\${encodeURIComponent('from plain fetch')}\`
const response = await fetch(url)
/* getEcho.url === '/route/getEcho'; getEcho.method === 'GET' */`} />
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
    <CodeBlock
        title="src/route/createEcho.ts (server — accepts JSON body or FormData)"
        code={`import { POST } from 'belte/route'
import { json } from 'belte/respond'

export const createEcho = POST<{ message: string }>(({ message }) =>
    json({ method: 'POST' as const, message }, { status: 201 }),
)`} />
    <CodeBlock
        title="this page (client — plain HTML form, no JS)"
        code={`<form method="POST" action={createEcho.url}>
    <input name="message" />
    <button type="submit">Submit</button>
</form>`} />
</section>
