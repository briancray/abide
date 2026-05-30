<script lang="ts">
import CodeBlock from '$browser/CodeBlock.svelte'
import { subscribe } from '@briancray/belte/browser/subscribe'
import { chat } from '$server/sockets/chat.ts'
import { publishChat } from '$server/rpc/publishChat.ts'

const latest = $derived(subscribe(chat))
const status = $derived(subscribe.status(chat))

let from = $state('alice')
let text = $state('hello from subscribe')
async function send() {
    await publishChat({ from, text })
}
</script>

<nav class="mb-2 text-sm text-slate-500">
    <a href="/browser" class="hover:text-slate-900"><code class="font-mono">belte/browser</code></a>
    <span class="mx-2">/</span>
    <span><code class="font-mono">subscribe()</code></span>
</nav>
<h1 class="text-3xl font-bold"><code class="font-mono">subscribe()</code></h1>
<p class="mt-2 text-slate-600">
    Reactive consumer for any <code class="font-mono">Subscribable&lt;T&gt;</code> — a
    <a class="underline" href="/server/sockets">socket</a> or
    <code class="font-mono">fn.stream(args)</code>. First read in a tracking scope opens the
    iterator; last reader closes it.
</p>

<section class="mt-6">
    <h2 class="text-sm font-semibold">Companions</h2>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">read</th>
                    <th class="px-4 py-2 font-medium">type</th>
                    <th class="px-4 py-2 font-medium">use for</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">subscribe(src)</td>
                    <td class="px-4 py-2 font-mono text-slate-500">T | undefined</td>
                    <td class="px-4 py-2 text-slate-600">latest frame; undefined until the first arrives</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">subscribe.status(src)</td>
                    <td class="px-4 py-2 font-mono text-slate-500">'pending' | 'open' | 'done' | 'error'</td>
                    <td class="px-4 py-2 text-slate-600">distinguish first-message-pending from clean end / error</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">subscribe.error(src)</td>
                    <td class="px-4 py-2 font-mono text-slate-500">Error | undefined</td>
                    <td class="px-4 py-2 text-slate-600">wire-layer error surface (reads don't throw)</td>
                </tr>
            </tbody>
        </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">
        <code class="font-mono">subscribe</code> is a no-op on the server. For SSR-friendly initial
        paint, seed with <a class="underline" href="/browser/cache"><code class="font-mono">cache()</code></a>
        then layer <code class="font-mono">subscribe()</code> on top after hydration.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Try it</h2>
    <p class="mt-1 font-mono text-xs text-slate-500">status: {status}</p>
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
        title="this page — reactive read + publish-through-rpc"
        code={`import { subscribe } from '@briancray/belte/browser/subscribe'
import { chat } from '$server/sockets/chat.ts'
import { publishChat } from '$server/rpc/publishChat.ts'

const latest = $derived(subscribe(chat))           // re-renders on every frame
const status = $derived(subscribe.status(chat))    // 'pending' | 'open' | 'done' | 'error'

async function send() {
    await publishChat({ from, text })              // POST → validates → chat.publish() on server
}`} />

    <CodeBlock
        title="SSR-friendly pattern — seed then subscribe"
        code={`const seed   = await cache(getRecentOrders)({ customerId })   // SSR snapshot, no live wire
const latest = $derived(subscribe(orders))                    // live updates after hydration`} />
</section>
