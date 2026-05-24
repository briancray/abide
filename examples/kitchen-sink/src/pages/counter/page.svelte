<script lang="ts">
import { cache } from 'belte/cache'
import { getCounter } from '$rpc/getCounter.ts'
import { incrementCounter } from '$rpc/incrementCounter.ts'
import { resetCounter } from '$rpc/resetCounter.ts'

/*
`cache()` inside `$derived.by` subscribes the deriving scope to the cache
key. When `cache.invalidate(getCounter)` fires, every derived re-runs,
misses, and gets a fresh promise. SSR has no tracking, so the call just
returns the snapshot promise once.
*/
const counter = $derived.by(() => cache(getCounter)().then((res) => res.json()))
const mirror = $derived(await cache(getCounter)().then((res) => res.json()))

async function increment() {
    await incrementCounter()
    cache.invalidate(getCounter)
}

async function reset() {
    await resetCounter()
}

async function refresh() {
    cache.invalidate(getCounter)
}
</script>

<h1 class="text-3xl font-bold">Live cache</h1>
<p class="mt-2 text-slate-600">
    Wrap <code class="font-mono">cache(fn)()</code> in <code class="font-mono">$derived.by</code>
    to subscribe. After a mutation, call
    <code class="font-mono">cache.invalidate(fn)</code>
    to broadcast — every derived binding for that key refetches.
</p>

<section class="mt-8 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-lg font-semibold">Counter</h2>
    {#await counter}
        <p class="mt-3 font-mono text-3xl text-slate-400">…</p>
    {:then data}
        <p class="mt-3 font-mono text-3xl text-slate-900">{data.count}</p>
    {:catch error}
        <p class="mt-3 font-mono text-sm text-red-600">{error.message}</p>
    {/await}

    <div class="mt-4 flex flex-wrap gap-2">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={increment}>
            POST /rpc/incrementCounter (increment and invalidate)
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={reset}>
            DELETE /rpc/resetCounter (reset no invalidate)
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={refresh}>
            invalidate only (refetch)
        </button>
    </div>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-lg font-semibold">Mirror</h2>
    <p class="mt-1 text-sm text-slate-600">
        A second <code class="font-mono">$derived.by(() => cache(getCounter)())</code> in the same page —
        both update together because they share one cache entry.
    </p>
        <p class="mt-3 font-mono text-3xl text-slate-900">{mirror.count}</p>
</section>
