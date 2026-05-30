<script lang="ts">
import CodeBlock from '$browser/CodeBlock.svelte'
import { subscribe } from '@briancray/belte/browser/subscribe'
import { chat } from '$server/sockets/chat.ts'
import { publishChat } from '$server/rpc/publishChat.ts'

const latest = $derived(subscribe(chat))

let from = $state('alice')
let text = $state('hello socket!')
async function send() {
    await publishChat({ from, text })
}
</script>

<nav class="mb-2 text-sm text-slate-500">
    <a href="/server" class="hover:text-slate-900"><code class="font-mono">belte/server</code></a>
    <span class="mx-2">/</span>
    <span>Sockets</span>
</nav>
<h1 class="text-3xl font-bold">Sockets</h1>
<p class="mt-2 text-slate-600">
    One topic per file under <code class="font-mono">src/server/sockets/</code>. A
    <code class="font-mono">Socket&lt;T&gt;</code>
    is an isomorphic <code class="font-mono">AsyncIterable&lt;T&gt;</code>
    — every socket multiplexes onto one ws at
    <code class="font-mono">/__belte/sockets</code>.
</p>

<section class="mt-6">
    <h2 class="text-sm font-semibold">Options</h2>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">option</th>
                    <th class="px-4 py-2 font-medium">default</th>
                    <th class="px-4 py-2 font-medium">effect</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">history</td>
                    <td class="px-4 py-2 font-mono text-slate-500">0</td>
                    <td class="px-4 py-2 text-slate-600">buffer last N messages for replay</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">ttl</td>
                    <td class="px-4 py-2 font-mono text-slate-500">undefined</td>
                    <td class="px-4 py-2 text-slate-600">per-frame max age in ms; older entries evicted lazily</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">clientPublish</td>
                    <td class="px-4 py-2 font-mono text-slate-500">false</td>
                    <td class="px-4 py-2 text-slate-600">when true, browser publishes are forwarded server-side</td>
                </tr>
            </tbody>
        </table>
    </div>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Try it</h2>
    <p class="mt-1 text-xs text-slate-500">
        <code class="font-mono">chat</code> has <code class="font-mono">clientPublish: false</code> —
        publishes route through <code class="font-mono">publishChat</code> (POST) so the server can
        validate first.
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
    {#if latest}
        <pre class="mt-3 overflow-x-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-slate-100"><code
            >{JSON.stringify(latest, undefined, 2)}</code></pre>
    {:else}
        <p class="mt-3 text-xs text-slate-500">(no message yet — publish something)</p>
    {/if}
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="src/server/sockets/chat.ts"
        code={`import { socket } from '@briancray/belte/server/socket'

export type ChatMessage = { id: string; from: string; text: string; at: number }

export const chat = socket<ChatMessage>({ history: 100 })`} />

    <CodeBlock
        title="src/server/rpc/publishChat.ts — validated publish path"
        code={`import { POST } from '@briancray/belte/server/POST'
import { error } from '@briancray/belte/server/error'
import { json } from '@briancray/belte/server/json'
import { chat, type ChatMessage } from '$server/sockets/chat.ts'

export const publishChat = POST<{ from: string; text: string }>(({ from, text }) => {
    if (!from.trim() || !text.trim()) return error(400, 'from and text required')
    const message: ChatMessage = { id: crypto.randomUUID(), from, text, at: Date.now() }
    chat.publish(message)
    return json(message)
})`} />

    <CodeBlock
        title="iteration — works the same on both sides"
        code={`for await (const m of chat)         { /* full history replay, then tail */ }
for await (const m of chat.tail())   { /* no replay — live only */ }
for await (const m of chat.tail(20)) { /* last 20 (clamped to history), then live */ }`} />

    <CodeBlock
        title="this page — reactive read"
        code={`import { subscribe } from '@briancray/belte/browser/subscribe'
import { chat } from '$server/sockets/chat.ts'

const latest = $derived(subscribe(chat))     // re-renders on every new frame`} />
</section>
