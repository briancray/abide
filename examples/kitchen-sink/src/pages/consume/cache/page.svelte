<script lang="ts">
import CodeBlock from '$lib/CodeBlock.svelte'
import { cache } from 'belte/consume'
import { getCounter } from '$route/getCounter.ts'
import { incrementCounter } from '$route/incrementCounter.ts'
import { resetCounter } from '$route/resetCounter.ts'

/*
Two derivations against the same cache key. They share one stored entry,
so when one mutation invalidates the key both re-run and stay in lockstep.
*/
const counter = $derived(cache(getCounter)())
const mirror = $derived(await cache(getCounter)())

async function increment() {
    await incrementCounter()
    cache.invalidate(getCounter)
}

async function reset() {
    await resetCounter()
    cache.invalidate(getCounter)
}
</script>

<h1 class="text-3xl font-bold"><code class="font-mono">cache()</code> + invalidation</h1>
<p class="mt-2 text-slate-600">
    Wrap a remote function call with
    <code class="font-mono">cache()</code>
    to get dedupe, an SSR snapshot, and reactivity. The first read on the server populates
    the cache; the snapshot is serialized into the HTML; the client picks it up during
    hydration with no second fetch. Reading inside
    <code class="font-mono">$derived</code>
    subscribes the deriving scope, so
    <code class="font-mono">cache.invalidate(fn)</code>
    re-runs every subscriber.
</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Counter</h2>
    {#await counter}
        <p class="mt-3 font-mono text-3xl text-slate-400">…</p>
    {:then data}
        <p class="mt-3 font-mono text-3xl text-slate-900">{data.count}</p>
    {:catch err}
        <p class="mt-3 font-mono text-sm text-red-600">{err.message}</p>
    {/await}
    <div class="mt-4 flex flex-wrap gap-2">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={increment}>
            POST incrementCounter (then invalidate)
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={reset}>
            DELETE resetCounter (then invalidate)
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={() => cache.invalidate(getCounter)}>
            invalidate only
        </button>
    </div>
    <CodeBlock
        title="src/route/getCounter.ts / incrementCounter.ts / resetCounter.ts (server)"
        code={`// getCounter.ts
export const getCounter = GET(() => json({ count: counterState.count }))

// incrementCounter.ts
export const incrementCounter = POST(() => {
    counterState.count += 1
    return json({ count: counterState.count })
})

// resetCounter.ts
export const resetCounter = DELETE(() => {
    counterState.count = 0
    return json({ count: counterState.count })
})`} />
    <CodeBlock
        title="this page (client)"
        code={`import { cache } from 'belte/consume'

const counter = $derived(cache(getCounter)())   // subscribes the deriving scope

async function increment() {
    await incrementCounter()
    cache.invalidate(getCounter)                // re-runs every $derived that read getCounter
}`} />
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Mirror</h2>
    <p class="mt-1 text-sm text-slate-600">
        Second <code class="font-mono">$derived(cache(getCounter)())</code>
        in the same page — both update together because they share one cache entry keyed by
        <code class="font-mono">method + url + args</code>.
    </p>
    <p class="mt-3 font-mono text-3xl text-slate-900">{mirror.count}</p>
    <CodeBlock
        title="this page (client) — second $derived against the same key"
        code={`const mirror = $derived(await cache(getCounter)())   // shares one entry with counter
/* both this and the counter above re-run on the same invalidation */`} />
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
    <h2 class="text-sm font-semibold text-slate-900">Options</h2>
    <CodeBlock
        code={`cache(fn)()                       /* lives forever, until invalidated */
cache(fn, { ttl: 0 })()           /* dedupe in-flight only */
cache(fn, { ttl: 30_000 })()      /* expire 30s after the promise settles */
cache(fn, { key: 'group' })()     /* group calls under one key */
cache.invalidate(fn)              /* drop every entry for this fn */
cache.invalidate(['key', 'id'])   /* drop one keyed entry */
cache.invalidate()                /* clear the whole store */`} />
</section>
