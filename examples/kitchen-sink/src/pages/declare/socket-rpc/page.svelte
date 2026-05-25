<script lang="ts">
import { chatFeed } from '$rpc/chatFeed.ts'
</script>

<h1 class="text-3xl font-bold">SOCKET rpcs</h1>
<p class="mt-2 text-slate-600">
    A <code class="font-mono">SOCKET</code> rpc is an async generator that yields frames. The
    framework owns a single multiplexed websocket per client at
    <code class="font-mono">/__belte/socket</code>
    — every SOCKET rpc rides on it, with the rpc URL acting as the channel.
</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Declaration — <code class="font-mono">src/rpc/chatFeed.ts</code></h2>
    <pre class="mt-3 overflow-x-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-slate-100"><code
        >{`import { SOCKET } from 'belte/rpc'
import { watchChat, type ChatMessage } from '../chatState.ts'

export const chatFeed = SOCKET<undefined, ChatMessage>(async function* () {
    for await (const message of watchChat()) {
        yield message
    }
})`}</code></pre>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
    <p>
        Consumers iterate the same way no matter the transport:
        <code class="font-mono">subscribe(chatFeed)()</code>
        in a $derived for reactive reads, or
        <code class="font-mono">for await (... of chatFeed.stream())</code>
        for a plain iterator. The live demo lives at
        <a class="underline" href="/consume/subscribe">/consume/subscribe</a>.
    </p>
    <p class="mt-3">
        URL: <code class="font-mono">{chatFeed.url}</code>
        (rides
        <code class="font-mono">/__belte/socket</code> on the wire).
    </p>
</section>
