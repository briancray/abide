<script lang="ts">
import { subscribe } from 'belte/cache'
import { tickFeed } from '$rpc/tickFeed.ts'
import { countLog } from '$rpc/countLog.ts'
import { chatFeed } from '$rpc/chatFeed.ts'
import { publishChat } from '$rpc/publishChat.ts'

/*
subscribe(fn)(args) returns the latest frame from a stream as a reactive
value. The first $derived read in a tracking scope opens the stream; the
last reader to drop closes it. Args change → old reader released, new
stream opened under a new key.

subscribe is a no-op on the server — SSR can't keep streams open across
the request boundary. Pages that want a value in the initial HTML should
seed via `cache(fn)()` and add `subscribe(fn)()` for live updates.
*/
const sseLatest = $derived(subscribe(tickFeed)())
const sseStatus = $derived(subscribe.status(tickFeed)())

let jsonlActive = $state(false)
const jsonlLatest = $derived(jsonlActive ? subscribe(countLog)({ to: 20 }) : undefined)
const jsonlStatus = $derived(jsonlActive ? subscribe.status(countLog)({ to: 20 }) : 'pending')

const chatLatest = $derived(subscribe(chatFeed)())

let from = $state('alice')
let text = $state('hello from /consume/subscribe')
async function send() {
    await publishChat({ from, text })
}
</script>

<h1 class="text-3xl font-bold"><code class="font-mono">subscribe()</code></h1>
<p class="mt-2 text-slate-600">
    Reactive consumer for remote streams. Works the same against an
    <code class="font-mono">sse(...)</code>
    handler, a <code class="font-mono">jsonl(...)</code>
    handler, or a <code class="font-mono">SOCKET</code>
    rpc — the call site never changes.
</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">SSE — <code class="font-mono">tickFeed</code></h2>
    <p class="mt-1 text-sm text-slate-600">
        Always-on subscription; closes the moment you navigate away.
    </p>
    <p class="mt-3 font-mono text-xs text-slate-700">status: {sseStatus}</p>
    {#if sseLatest}
        <p class="mt-1 font-mono text-xs text-slate-700">latest: tick={sseLatest.tick} at={sseLatest.at}</p>
    {:else}
        <p class="mt-1 font-mono text-xs text-slate-500">(no frame yet)</p>
    {/if}
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">JSONL — <code class="font-mono">countLog</code></h2>
    <p class="mt-1 text-sm text-slate-600">
        Toggle the subscription to see the lifecycle — the stream opens on first read and
        closes when the last $derived stops reading it.
    </p>
    <button
        type="button"
        class="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        onclick={() => { jsonlActive = !jsonlActive }}>
        {jsonlActive ? 'unsubscribe' : 'subscribe'}
    </button>
    <p class="mt-3 font-mono text-xs text-slate-700">status: {jsonlStatus}</p>
    {#if jsonlLatest}
        <p class="mt-1 font-mono text-xs text-slate-700">latest n: {jsonlLatest.n}</p>
    {/if}
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">SOCKET — <code class="font-mono">chatFeed</code></h2>
    <p class="mt-1 text-sm text-slate-600">
        Multiplexed onto <code class="font-mono">/__belte/socket</code>. Publish from here
        (or from <a class="underline" href="/reply/request-and-server">/reply/request-and-server</a>)
        and every subscriber re-renders.
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
    {#if chatLatest}
        <pre class="mt-3 overflow-x-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-slate-100"><code
            >{JSON.stringify(chatLatest, undefined, 2)}</code></pre>
    {:else}
        <p class="mt-3 text-xs text-slate-500">(no frame yet — publish something)</p>
    {/if}
</section>
