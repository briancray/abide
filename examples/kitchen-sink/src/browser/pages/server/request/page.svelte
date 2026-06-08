<script lang="ts">
import { subscribe } from '@belte/belte/browser/subscribe'
import { cache } from '@belte/belte/shared/cache'
import CodeBlock from '$browser/CodeBlock.svelte'
import { publishChat } from '$server/rpc/publishChat.ts'
import { whoAmI } from '$server/rpc/whoAmI.ts'
import { chat } from '$server/sockets/chat.ts'

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

<nav class="mb-2 text-sm text-slate-500">
    <a href="/server" class="hover:text-slate-900"><code class="font-mono">belte/server</code></a>
    <span class="mx-2">/</span>
    <span><code class="font-mono">request()</code> +<code class="font-mono">server()</code></span>
</nav>
<h1 class="text-3xl font-bold">
    <code class="font-mono">request()</code> +<code class="font-mono">server()</code>
</h1>
<p class="mt-2 text-slate-600">
    Per-request and server-wide accessors backed by<code class="font-mono">AsyncLocalStorage</code>
    . Reach for them from any scope inside a handler or SSR pass — no plumbing.
</p>

<section class="mt-6">
    <div class="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">accessor</th>
                    <th class="px-4 py-2 font-medium">returns</th>
                    <th class="px-4 py-2 font-medium">throws when</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">request()</td>
                    <td class="px-4 py-2 font-mono text-slate-500">Request</td>
                    <td class="px-4 py-2 text-slate-600">called outside a request scope</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">server()</td>
                    <td class="px-4 py-2 font-mono text-slate-500">Bun.Server</td>
                    <td class="px-4 py-2 text-slate-600">
                        called before<code class="font-mono">Bun.serve</code> finishes booting
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">
        <code class="font-mono">request()</code> — read inbound headers
    </h2>
    <p class="mt-1 text-xs text-slate-500">
        <code class="font-mono">whoAmI()</code> reads<code class="font-mono">cookie</code> and
        <code class="font-mono">user-agent</code> off the inbound request — same on SSR and over the
        wire.
    </p>
    <pre
        class="mt-3 overflow-x-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-slate-100"><code
        >{JSON.stringify(me, undefined, 2)}</code></pre>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Publish through a validated rpc</h2>
    <p class="mt-1 text-xs text-slate-500">
        <code class="font-mono">publishChat</code> validates, then calls
        <code class="font-mono">chat.publish(message)</code>
        .<code class="font-mono">server()</code>
        is used implicitly by the socket runtime to fan out to remote subscribers.
    </p>
    <div class="mt-3 flex flex-wrap items-end gap-2">
        <label class="text-xs font-medium">
            from
            <input
                bind:value={from}
                class="mt-1 block rounded-md border border-slate-300 px-3 py-1.5 text-sm">
        </label>
        <label class="flex-1 text-xs font-medium">
            text
            <input
                bind:value={text}
                class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm">
        </label>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={send}>
            publish
        </button>
    </div>
    <p class="mt-2 text-xs text-slate-500">{lastSendResult}</p>
    {#if latestChat}
        <pre
            class="mt-3 overflow-x-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-slate-100"><code
            >{JSON.stringify(latestChat, undefined, 2)}</code></pre>
    {/if}
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="src/server/rpc/whoAmI.ts"
        code={`import { GET } from '@belte/belte/server/GET'
import { request } from '@belte/belte/server/request'
import { json } from '@belte/belte/server/json'

export const whoAmI = GET(() => {
    const headers = request().headers
    return json({
        hasCookie: headers.has('cookie'),
        userAgent: headers.get('user-agent'),
    })
})`} />

    <CodeBlock
        title="src/server/rpc/publishChat.ts"
        code={`import { POST } from '@belte/belte/server/POST'
import { error } from '@belte/belte/server/error'
import { json } from '@belte/belte/server/json'
import { chat, type ChatMessage } from '$server/sockets/chat.ts'

export const publishChat = POST<{ from: string; text: string }>(({ from, text }) => {
    if (!from.trim() || !text.trim()) return error(400, 'from and text are required')
    const message: ChatMessage = { id: crypto.randomUUID(), from, text, at: Date.now() }
    chat.publish(message)
    return json(message)
})`} />

    <CodeBlock
        title="this page — SSR + reactive read"
        code={`import { cache } from '@belte/belte/shared/cache'
import { subscribe } from '@belte/belte/browser/subscribe'
import { whoAmI } from '$server/rpc/whoAmI.ts'
import { chat } from '$server/sockets/chat.ts'

const me         = await cache(whoAmI)()         // runs during SSR, replays on hydration
const latestChat = $derived(subscribe(chat))     // reactive — re-renders per frame`} />
</section>
