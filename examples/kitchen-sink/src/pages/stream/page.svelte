<script lang="ts">
import CodeBlock from '$lib/CodeBlock.svelte'
import { subscribe } from 'belte/consume'
import { chat } from '$stream/chat.ts'
import { publishChat } from '$route/publishChat.ts'

const latest = $derived(subscribe(chat))

let from = $state('alice')
let text = $state('hello stream!')
async function send() {
    await publishChat({ from, text })
}
</script>

<h1 class="text-3xl font-bold">Stream</h1>
<p class="mt-2 text-slate-600">
    Named broadcast topics — the framework's third declaration primitive, alongside
    <code class="font-mono">route/</code> (HTTP) and
    <code class="font-mono">pages/</code> (SSR + hydrate). Each
    <code class="font-mono">src/stream/&lt;file&gt;.ts</code>
    exports one stream; the same import resolves on both sides, both publish and subscribe
    are isomorphic, and all streams multiplex onto one framework-owned ws at
    <code class="font-mono">/__belte/stream</code>.
</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Declaration</h2>
    <p class="mt-1 text-sm text-slate-600">
        One named export per file; the file path becomes the stream's identity.
        Options live in the constructor — <code class="font-mono">history</code>
        sets how many recent messages new subscribers replay, and
        <code class="font-mono">clientPublish</code>
        opts in to direct browser publish (default off, so apps that need auth route
        through HTTP).
    </p>
    <CodeBlock
        title="src/stream/chat.ts"
        code={`import { stream } from 'belte/stream'

export type ChatMessage = { id: string; from: string; text: string; at: number }

export const chat = stream<ChatMessage>({ history: 100 })`} />
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Publishing — gated through HTTP</h2>
    <p class="mt-1 text-sm text-slate-600">
        Because <code class="font-mono">chat</code>
        was declared without <code class="font-mono">clientPublish: true</code>,
        the browser can't publish directly. A POST route validates input and calls
        <code class="font-mono">chat.publish(message)</code>;
        in-process iterators get notified directly and remote subscribers
        receive a frame via Bun's native publish.
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
    <CodeBlock
        title="src/route/publishChat.ts"
        code={`import { POST } from 'belte/route'
import { error, json } from 'belte/respond'
import { chat, type ChatMessage } from '$stream/chat.ts'

export const publishChat = POST<{ from: string; text: string }>(({ from, text }) => {
    if (!from.trim() || !text.trim()) return error(400, 'from and text are required')
    const message: ChatMessage = { id: crypto.randomUUID(), from, text, at: Date.now() }
    chat.publish(message)
    return json(message)
})`} />
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Consuming</h2>
    <p class="mt-1 text-sm text-slate-600">
        The reactive client-side read lives in
        <code class="font-mono">belte/consume</code>:
        <code class="font-mono">$derived(subscribe(chat))</code>
        re-renders on every new message. For low-level iteration on either side
        (or for server-side fan-in), use the iterable directly —
        <code class="font-mono">for await (const m of chat)</code>
        replays history then tails live, <code class="font-mono">chat.tail()</code>
        opts out of replay.
    </p>
    <CodeBlock
        title="this page (client)"
        code={`import { subscribe } from 'belte/consume'
import { chat } from '$stream/chat.ts'
import { publishChat } from '$route/publishChat.ts'

const latest = $derived(subscribe(chat))         // reactive — latest message

async function send() {
    await publishChat({ from, text })            // POST flow for auth
}`} />
    <CodeBlock
        title="raw iteration (works on both sides)"
        code={`for await (const message of chat) {
    /* replays the last \`history\` messages, then tails live */
}

for await (const message of chat.tail()) {
    /* skip the replay; only live messages from here on */
}`} />
</section>
