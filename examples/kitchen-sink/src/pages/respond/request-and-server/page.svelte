<script lang="ts">
import CodeBlock from '$lib/CodeBlock.svelte'
import { cache, subscribe } from 'belte/consume'
import { whoAmI } from '$route/whoAmI.ts'
import { publishChat } from '$route/publishChat.ts'
import { chat } from '$stream/chat.ts'

/*
SSR-friendly seed for the initial paint: whoAmI runs during the server
render so the page knows whether a cookie is present before the client
has a chance to ask.
*/
const me = await cache(whoAmI)()

let from = $state('alice')
let text = $state('hello belte')
let lastSendResult = $state('(not sent)')

const latestChat = $derived(subscribe(chat))

async function send() {
    try {
        const message = await publishChat({ from, text })
        lastSendResult = `published ${message.id} at ${new Date(message.at).toLocaleTimeString()}`
    } catch (err) {
        lastSendResult = String(err)
    }
}
</script>

<h1 class="text-3xl font-bold"><code class="font-mono">request()</code> + <code class="font-mono">server</code></h1>
<p class="mt-2 text-slate-600">
    <code class="font-mono">request()</code>
    from <code class="font-mono">belte/server</code>
    returns the inbound <code class="font-mono">Request</code>
    inside any handler or page render — no plumbing. The
    <code class="font-mono">server</code>
    proxy is a stable reference to the live
    <code class="font-mono">Bun.Server</code>; reach for it from module scope when you need
    it. Most apps won't — the framework's
    <a class="underline" href="/stream">stream</a>
    primitive already rides on Bun's native publish under the hood.
</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">request() — read inbound headers</h2>
    <p class="mt-2 text-sm text-slate-600">
        <code class="font-mono">whoAmI()</code>
        reads <code class="font-mono">cookie</code> and
        <code class="font-mono">user-agent</code> off
        <code class="font-mono">request().headers</code>
        — works the same on this page's SSR pass as it does when called over the wire.
    </p>
    <pre class="mt-3 overflow-x-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-slate-100"><code
        >{JSON.stringify(me, undefined, 2)}</code></pre>
    <CodeBlock
        title="src/route/whoAmI.ts (server)"
        code={`import { GET } from 'belte/route'
import { request } from 'belte/server'
import { json } from 'belte/respond'

export const whoAmI = GET(() => {
    const headers = request().headers
    return json({
        hasCookie: headers.has('cookie'),
        userAgent: headers.get('user-agent'),
    })
})`} />
    <CodeBlock
        title="this page (client + SSR — same line on both sides)"
        code={`import { cache } from 'belte/consume'
import { whoAmI } from '$route/whoAmI.ts'

/* top-level await inside the page <script> runs during SSR; the cache
   snapshot replays on hydration so no second fetch happens. */
const me = await cache(whoAmI)()`} />
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">publish through a stream</h2>
    <p class="mt-1 text-sm text-slate-600">
        <code class="font-mono">publishChat</code>
        validates input then calls
        <code class="font-mono">chat.publish(message)</code> —
        in-process subscribers are notified directly and remote ws
        subscribers receive a frame via Bun's native publish under the hood.
    </p>
    <div class="mt-3 flex flex-wrap items-end gap-2">
        <label class="text-xs font-medium">
            from
            <input
                bind:value={from}
                class="mt-1 block rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
        </label>
        <label class="flex-1 text-xs font-medium">
            text
            <input
                bind:value={text}
                class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
        </label>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={send}>
            publish
        </button>
    </div>
    <p class="mt-2 text-xs text-slate-500">{lastSendResult}</p>
    <p class="mt-4 text-sm text-slate-600">
        Latest message (reactive via
        <code class="font-mono">subscribe(chat)</code>):
    </p>
    {#if latestChat}
        <pre class="mt-2 overflow-x-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-slate-100"><code
            >{JSON.stringify(latestChat, undefined, 2)}</code></pre>
    {:else}
        <p class="mt-2 text-xs text-slate-500">(no message yet)</p>
    {/if}
    <CodeBlock
        title="src/route/publishChat.ts (server)"
        code={`import { POST } from 'belte/route'
import { error, json } from 'belte/respond'
import { chat, type ChatMessage } from '$stream/chat.ts'

export const publishChat = POST<{ from: string; text: string }>(({ from, text }) => {
    if (!from.trim() || !text.trim()) return error(400, 'from and text are required')
    const message: ChatMessage = { id: crypto.randomUUID(), from, text, at: Date.now() }
    chat.publish(message)
    return json(message)
})`} />
    <CodeBlock
        title="this page (client)"
        code={`import { subscribe } from 'belte/consume'
import { chat } from '$stream/chat.ts'
import { publishChat } from '$route/publishChat.ts'

const latestChat = $derived(subscribe(chat))   // reactive — re-renders on every message

async function send() {
    await publishChat({ from, text })          // POST → validates → chat.publish() on the server
}`} />
</section>
