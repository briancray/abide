<script lang="ts">
import { cache } from '@belte/belte/shared/cache'
import { pending } from '@belte/belte/shared/pending'
import { refreshing } from '@belte/belte/shared/refreshing'
import CodeBlock from '$browser/CodeBlock.svelte'
import { createEcho } from '$server/rpc/createEcho.ts'
import { getRates } from '$server/rpc/getRates.ts'

/*
The mutation idiom: ttl 0 retains nothing beyond the store's atomic unit,
so the wrap buys double-submit coalescing plus probe visibility — while
the POST is in flight, an identical click joins it instead of firing
again, and pending(createEcho) is true from anywhere.
*/
const submit = cache(createEcho, { ttl: 0 })
let message = $state('hello probes')
let echoed = $state('')
async function send() {
    const result = await submit({ message })
    echoed = result.message
}
const submitting = $derived(pending(createEcho))

/*
Stale-while-revalidate, observed: the debounce policy means an invalidate
hit keeps this entry and coalesces the refetch — the stale rates stay on
screen while refreshing(getRates) is true.
*/
const rates = $derived(cache(getRates, { invalidate: { debounce: 300 } })({ base: 'USD' }))
const updating = $derived(refreshing(getRates))
</script>

<nav class="mb-2 text-sm text-slate-500">
    <a href="/shared" class="hover:text-slate-900"><code class="font-mono">belte/shared</code></a>
    <span class="mx-2">/</span>
    <span>
        <code class="font-mono">pending()</code>
        / <code class="font-mono">refreshing()</code>
    </span>
</nav>
<h1 class="text-3xl font-bold">
    <code class="font-mono">pending()</code>
    / <code class="font-mono">refreshing()</code>
</h1>
<p class="mt-2 text-slate-600">
    Standalone reactive probes — their own modules, not properties of
    <code class="font-mono">cache</code>. They span both registries:
    <a class="underline" href="/shared/cache"><code class="font-mono">cache()</code></a>
    calls and
    <a class="underline" href="/browser/tail"><code class="font-mono">tail()</code></a>
    streams. <code class="font-mono">pending</code> means "no value yet";
    <code class="font-mono">refreshing</code>
    means "value held, fresher source in flight" — never a merely-open stream.
</p>

<section class="mt-6">
    <h2 class="text-sm font-semibold">Selector grammar</h2>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">call</th>
                    <th class="px-4 py-2 font-medium">answers</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">pending()</td>
                    <td class="px-4 py-2 text-slate-600">
                        anything in flight, either registry (global activity bar)
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">pending(fn)</td>
                    <td class="px-4 py-2 text-slate-600">
                        any call of that function in flight (remote or producer)
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">{'pending({ scope })'}</td>
                    <td class="px-4 py-2 text-slate-600">a tagged group</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">pending(chat)</td>
                    <td class="px-4 py-2 text-slate-600">that stream awaiting its first frame</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">refreshing()</td>
                    <td class="px-4 py-2 text-slate-600">anything reloading data it already had</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">refreshing(fn)</td>
                    <td class="px-4 py-2 text-slate-600">
                        that function revalidating (policy refetch or drop-then-reload)
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">refreshing(chat)</td>
                    <td class="px-4 py-2 text-slate-600">
                        that stream reconnecting with its last value retained
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">
        <strong>Probes report, never act</strong>
        — reading one opens no fetch and no stream. Inside <code class="font-mono">$derived</code> /
        <code class="font-mono">$effect</code>
        they re-run on state changes; outside a tracking scope they return the current value. SSR
        loading state is driven by <code class="font-mono">{'{#await}'}</code>, not this.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold">
            The mutation idiom — <code class="font-mono">ttl: 0</code>
        </h2>
        <span
            class="rounded-full px-2 py-0.5 text-xs {submitting
                ? 'bg-amber-100 text-amber-700'
                : 'bg-slate-100 text-slate-400'}">
            {submitting ? 'submitting…' : 'idle'}
        </span>
    </div>
    <p class="mt-1 text-xs text-slate-500">
        <code class="font-mono">{'cache(createEcho, { ttl: 0 })'}</code>
        coalesces identical in-flight submits (double-click protection) and retains nothing once
        settled. The button disables on <code class="font-mono">pending(createEcho)</code>.
    </p>
    <div class="mt-3 flex flex-wrap items-end gap-2">
        <label class="flex-1 text-xs font-medium">
            message
            <input
                bind:value={message}
                class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm">
        </label>
        <button
            type="button"
            disabled={submitting}
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40"
            onclick={send}>
            POST /rpc/createEcho
        </button>
    </div>
    {#if echoed}
        <p class="mt-3 font-mono text-xs text-slate-500">echoed: {echoed}</p>
    {/if}
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold">Stale-while-revalidate, observed</h2>
        <span
            class="rounded-full px-2 py-0.5 text-xs {updating
                ? 'bg-amber-100 text-amber-700'
                : 'bg-slate-100 text-slate-400'}">
            {updating ? 'updating…' : 'fresh'}
        </span>
    </div>
    <p class="mt-1 text-xs text-slate-500">
        The read carries <code class="font-mono">{'invalidate: { debounce: 300 }'}</code>, so an
        invalidation keeps the entry and coalesces the refetch — the stale rates stay visible while
        <code class="font-mono">refreshing(getRates)</code>
        is true.
        <code class="font-mono">pending(getRates)</code>
        stays false the whole time: there was never a moment without a value.
    </p>
    <div class="mt-3">
        {#await rates}
            <p class="font-mono text-sm text-slate-400">loading rates…</p>
        {:then data}
            <p class="font-mono text-sm text-slate-900">
                1 {data.base} = {data.rates.EUR} EUR
                <span class="text-slate-400">({data.date})</span>
            </p>
        {:catch err}
            <p class="font-mono text-sm text-red-600">{err.message}</p>
        {/await}
    </div>
    <button
        type="button"
        class="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        onclick={() => cache.invalidate(getRates)}>
        invalidate (spam me)
    </button>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="this page — both probes live"
        code={`import { cache } from '@belte/belte/shared/cache'
import { pending } from '@belte/belte/shared/pending'
import { refreshing } from '@belte/belte/shared/refreshing'

// mutation idiom: coalesce in flight, retain nothing, observe from anywhere
const submit = cache(createEcho, { ttl: 0 })
const submitting = $derived(pending(createEcho))

// stale-while-revalidate: the policy keeps the entry; refreshing reports the gap
const rates = $derived(cache(getRates, { invalidate: { debounce: 300 } })({ base: 'USD' }))
const updating = $derived(refreshing(getRates))`} />

    <CodeBlock
        title="cross-registry — streams answer the same questions"
        code={`import { tail } from '@belte/belte/browser/tail'
import { chat } from '$server/sockets/chat.ts'

const latest = $derived(tail(chat))
const waiting = $derived(pending(chat))       // awaiting the first frame
const reconnecting = $derived(refreshing(chat)) // transport lost, last value retained`} />
</section>
