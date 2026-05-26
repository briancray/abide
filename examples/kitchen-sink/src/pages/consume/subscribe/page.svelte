<script lang="ts">
import CodeBlock from '$lib/CodeBlock.svelte'
import { subscribe } from 'belte/consume'
import { chat } from '$stream/chat.ts'
import { publishChat } from '$route/publishChat.ts'

/*
subscribe(stream) returns the latest published value as a reactive
value. The first $derived read in a tracking scope opens the
subscription (with history replay so newcomers immediately see the
last value), and the last reader to drop closes it.

subscribe is a no-op on the server — SSR can't keep streams open
across the request boundary. Pages that want a seeded value in the
initial HTML should fetch a snapshot via cache() against an HTTP
route, then layer subscribe() on top for live updates after hydration.
*/
const latest = $derived(subscribe(chat))
const status = $derived(subscribe.status(chat))

let from = $state('alice')
let text = $state('hello from /consume/subscribe')
async function send() {
    await publishChat({ from, text })
}
</script>

<h1 class="text-3xl font-bold"><code class="font-mono">subscribe()</code></h1>
<p class="mt-2 text-slate-600">
    Reactive consumer for streams. Pass a
    <code class="font-mono">Stream&lt;T&gt;</code>
    declared under <code class="font-mono">src/stream/</code>
    and read the latest published value inside any
    <code class="font-mono">$derived</code>.
</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Stream — <code class="font-mono">chat</code></h2>
    <p class="mt-1 text-sm text-slate-600">
        Multiplexed onto <code class="font-mono">/__belte/stream</code>. Publishing routes through
        <code class="font-mono">publishChat</code>
        (an HTTP POST) so the input is validated server-side — the stream itself was declared
        without <code class="font-mono">clientPublish: true</code>, so a direct browser
        publish would be silently dropped.
    </p>
    <p class="mt-3 font-mono text-xs text-slate-700">status: {status}</p>
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
    <CodeBlock
        title="src/stream/chat.ts (declaration)"
        code={`import { stream } from 'belte/stream'

export type ChatMessage = { id: string; from: string; text: string; at: number }

export const chat = stream<ChatMessage>({ history: 100 })`} />
    <CodeBlock
        title="src/route/publishChat.ts (server-side publish + validation)"
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

const latest = $derived(subscribe(chat))           // reactive — re-renders on every message

async function send() {
    await publishChat({ from, text })              // POST routes through server validation
}`} />
</section>
