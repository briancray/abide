<script lang="ts">
import { tail } from '@belte/belte/browser/tail'
import CodeBlock from '$browser/CodeBlock.svelte'
import { publishChat } from '$server/rpc/publishChat.ts'
import { chat } from '$server/sockets/chat.ts'

const latest = $derived(tail(chat))
const recent = $derived(tail(chat, { last: 5 }))
const status = $derived(tail.status(chat))

let from = $state('alice')
let text = $state('hello from tail')
async function send() {
    await publishChat({ from, text })
}
</script>

<nav class="mb-2 text-sm text-slate-500">
    <a href="/browser" class="hover:text-slate-900"><code class="font-mono">belte/browser</code></a>
    <span class="mx-2">/</span>
    <span><code class="font-mono">tail()</code></span>
</nav>
<h1 class="text-3xl font-bold"><code class="font-mono">tail()</code></h1>
<p class="mt-2 text-slate-600">
    Reactive consumer for any <code class="font-mono">Subscribable&lt;T&gt;</code> — a
    <a class="underline" href="/server/sockets">socket</a>
    or
    <code class="font-mono">fn.stream(args)</code>. Bare, it is the latest-wins read; with
    <code class="font-mono">{'{ last: n }'}</code>, a live window of the last ≤ n frames. First read
    in a tracking scope opens the iterator; last reader closes it.
</p>

<section class="mt-6">
    <h2 class="text-sm font-semibold">Forms</h2>
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
                    <td class="px-4 py-2 font-mono">tail(src)</td>
                    <td class="px-4 py-2 font-mono text-slate-500">T | undefined</td>
                    <td class="px-4 py-2 text-slate-600">
                        latest frame; undefined until the first arrives
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">tail(src, {'{ last: n }'})</td>
                    <td class="px-4 py-2 font-mono text-slate-500">T[]</td>
                    <td class="px-4 py-2 text-slate-600">
                        live window of the last ≤ n frames; [] while pending, never undefined
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">tail.status(src, options?)</td>
                    <td class="px-4 py-2 font-mono text-slate-500">
                        'pending' | 'open' | 'done' | 'error'
                    </td>
                    <td class="px-4 py-2 text-slate-600">
                        distinguish first-frame-pending from clean end / error; same options address
                        the same entry
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">tail.error(src, options?)</td>
                    <td class="px-4 py-2 font-mono text-slate-500">Error | undefined</td>
                    <td class="px-4 py-2 text-slate-600">
                        wire-layer error surface (reads don't throw)
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">
        Readers of the same source and window size share one subscription — the bare form and each
        <code class="font-mono">last</code>
        are independent. A socket declared
        <code class="font-mono">{'{ tail: n }'}</code>
        seeds the read from its retained tail in a single update; a source with no retention (an rpc
        stream, an undeclared socket) starts live-only.
        <code class="font-mono">tail</code>
        is a no-op on the server — seed initial paint with
        <a class="underline" href="/shared/cache">
            <code class="font-mono">cache()</code>
        </a>
        then layer <code class="font-mono">tail()</code> on top after hydration. The cross-registry
        probes answer for streams too:
        <a class="underline" href="/shared/probes">
            <code class="font-mono">pending(chat)</code>
        </a>
        is true while the first frame is awaited.
    </p>
</section>

<section class="mt-6">
    <h2 class="text-sm font-semibold">Transport loss self-heals</h2>
    <p class="mt-2 text-sm text-slate-600">
        If the socket channel drops, the held value or window is retained,
        <a class="underline" href="/shared/probes">
            <code class="font-mono">refreshing(chat)</code>
        </a>
        reports true across the gap, and the stream reopens under the channel's backoff —
        <code class="font-mono">status</code>
        never degrades to <code class="font-mono">'error'</code> for a disconnect. On reconnect the
        replay commits over the window atomically; when nothing was retained, the held window stays
        and live frames append. Application errors (a stream that throws) stay terminal and surface
        through <code class="font-mono">tail.error</code>.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Try it</h2>
    <p class="mt-1 font-mono text-xs text-slate-500">status:{status}</p>
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
    {#if latest}
        <p class="mt-3 text-xs font-medium text-slate-500">tail(chat) — latest</p>
        <pre
            class="mt-1 overflow-x-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-slate-100"><code
            >{JSON.stringify(latest, undefined, 2)}</code></pre>
    {:else}
        <p class="mt-3 text-xs text-slate-500">(no message yet — publish something)</p>
    {/if}
    {#if recent.length > 0}
        <p class="mt-3 text-xs font-medium text-slate-500">
            tail(chat, {'{ last: 5 }'}) — live window
        </p>
        <ul class="mt-1 space-y-1">
            {#each recent as message (message.id)}
                <li class="rounded-md bg-slate-100 px-3 py-1.5 font-mono text-xs text-slate-700">
                    {message.from}: {message.text}
                </li>
            {/each}
        </ul>
    {/if}
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="this page — latest + window + publish-through-rpc"
        code={`import { tail } from '@belte/belte/browser/tail'
import { chat } from '$server/sockets/chat.ts'
import { publishChat } from '$server/rpc/publishChat.ts'

const latest = $derived(tail(chat))                 // newest frame, re-renders per frame
const recent = $derived(tail(chat, { last: 5 }))    // last ≤5 frames, seeded from the retained tail
const status = $derived(tail.status(chat))          // 'pending' | 'open' | 'done' | 'error'

async function send() {
    await publishChat({ from, text })               // POST → validates → chat.publish() on server
}`} />

    <CodeBlock
        title="SSR-friendly pattern — seed then tail"
        code={`const seed   = await cache(getRecentOrders)({ customerId })   // SSR snapshot, no live wire
const latest = $derived(tail(orders))                         // live updates after hydration`} />
</section>
