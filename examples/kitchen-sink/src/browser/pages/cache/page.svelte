<script lang="ts">
import { cache } from '@belte/belte/shared/cache'
import { pending } from '@belte/belte/shared/pending'
import CodeBlock from '$browser/CodeBlock.svelte'
import { getCounter } from '$server/rpc/getCounter.ts'
import { incrementCounter } from '$server/rpc/incrementCounter.ts'
import { resetCounter } from '$server/rpc/resetCounter.ts'

/*
Two derivations against the same cache key, both tagged with the same
scope. They share one stored entry, so any invalidation — by fn or by
scope — re-runs both and they stay in lockstep.
*/
const counter = $derived(cache(getCounter, { scope: 'counter' })())
const mirror = $derived(await cache(getCounter, { scope: 'counter' })())

/*
Standalone reactive probe (own module, not a cache property): true while
any getCounter call is in flight. The read taps the store's lifecycle
channel, so this $derived re-runs the moment a matching call starts or
settles. See /probes for the full grammar.
*/
const loading = $derived(pending(getCounter))

async function increment() {
    await incrementCounter()
    cache.invalidate(getCounter)
}

async function reset() {
    await resetCounter()
    cache.invalidate(getCounter)
}
</script>

<h1 class="text-3xl font-bold"><code class="font-mono">cache()</code></h1>
<p class="mt-2 text-slate-600">
    Isomorphic — wraps a remote call (or any async function) with coalescing, SSR snapshot, and
    reactivity, the same line on server and client. Coalescing is always on: identical in-flight
    calls share one flight. <code class="font-mono">ttl</code> is purely the retention added on top.
</p>

<section class="mt-6">
    <h2 class="text-sm font-semibold">Options</h2>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">option</th>
                    <th class="px-4 py-2 font-medium">value</th>
                    <th class="px-4 py-2 font-medium">effect</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono" rowspan="3">ttl</td>
                    <td class="px-4 py-2 font-mono text-slate-500">undefined</td>
                    <td class="px-4 py-2 text-slate-600">cached until invalidated (default)</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono text-slate-500">0</td>
                    <td class="px-4 py-2 text-slate-600">
                        coalesce only — nothing retained beyond the store's atomic unit: the whole
                        request on the server (one render, one effect), the in-flight window in the
                        tab. The mutation idiom — double-submits collapse,
                        <code class="font-mono">pending()</code>
                        sees it; see
                        <a class="underline" href="/probes">pending / refreshing</a>
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono text-slate-500">number (ms)</td>
                    <td class="px-4 py-2 text-slate-600">expire that long after resolve</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">scope</td>
                    <td class="px-4 py-2 font-mono text-slate-500">string / string[]</td>
                    <td class="px-4 py-2 text-slate-600">
                        declared identity tags: any module can invalidate or probe the group without
                        importing the wrapped function; a call can join several groups
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">global</td>
                    <td class="px-4 py-2 font-mono text-slate-500">true</td>
                    <td class="px-4 py-2 text-slate-600">
                        store in the process-level cache so a value computed in one request is
                        reused by later ones (server). A no-op on the client — one tab store either
                        way.
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">invalidate</td>
                    <td class="px-4 py-2 font-mono text-slate-500">
                        {'{ throttle: n } | { debounce: n }'}
                    </td>
                    <td class="px-4 py-2 text-slate-600">
                        stale-while-revalidate: an invalidation hit keeps the entry, serves the
                        stale value, and coalesces the refetch — throttle at most once per window,
                        debounce once after quiet. A policy declares the call safe to re-run
                        unprompted, enforced at wrap time: non-GET remotes throw, so does
                        <code class="font-mono">ttl: 0</code>
                        (nothing retained, nothing to revalidate) and setting both knobs.
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">
        The key is always auto-derived — method + url + args for a remote function, the producer's
        reference + args for a plain producer. Producers key by reference — hoist them; inline
        arrows mint a fresh identity per call and never coalesce (belte warns once per call site).
        Server-rendered GET reads ship in the page snapshot and hydrate warm; a hydrated entry
        adopts the first reading call site's <code class="font-mono">ttl</code>. Wrap the original
        function once — <code class="font-mono">cache(cache(fn))</code> throws at wrap time.
    </p>
</section>

<section class="mt-6">
    <h2 class="text-sm font-semibold"><code class="font-mono">cache.invalidate</code></h2>
    <ul class="mt-2 space-y-1 text-sm text-slate-600">
        <li><code class="font-mono">cache.invalidate()</code> — drop everything</li>
        <li>
            <code class="font-mono">cache.invalidate(fn)</code>
            — drop one function's calls (a remote fn — fn or fn.raw — or a producer)
        </li>
        <li>
            <code class="font-mono">{'cache.invalidate({ scope })'}</code>
            — drop every entry sharing any of the scope's tags
        </li>
    </ul>
    <p class="mt-2 text-xs text-slate-500">
        An entry carrying an <code class="font-mono">invalidate</code> policy is never dropped — it
        revalidates in place, stale value visible until the refetch lands. Loading state lives in
        the standalone probes:
        <a class="underline" href="/probes">
            <code class="font-mono">pending()</code>
            / <code class="font-mono">refreshing()</code>
        </a>.
    </p>
</section>

<section class="mt-6">
    <h2 class="text-sm font-semibold">SSR mode is the consumption form</h2>
    <ul class="mt-2 space-y-1 text-sm text-slate-600">
        <li>
            <code class="font-mono">await cache(getPost)({`{ id }`})</code>
            — blocks render, bakes into the SSR HTML (the layout's session read works this way).
        </li>
        <li>
            <code class="font-mono">{'{#await cache(getPost)({ id })}'}</code>
            — flushes the shell now, streams the value in (the counter card below).
        </li>
    </ul>
    <ul class="mt-2 space-y-1 text-xs text-slate-500">
        <li>
            Warm SSR keys return <strong>synchronously</strong> (<code class="font-mono"
                >Promise&lt;Return&gt; | Return</code
            >) — consume with
            <code class="font-mono">await</code>/<code class="font-mono">{'{#await}'}</code>
            + <code class="font-mono">try/catch</code>, never
            <code class="font-mono">.then</code>/<code class="font-mono">.catch</code>.
        </li>
        <li>
            One top-level <code class="font-mono">await</code> puts the whole component in
            await-everything mode — isolate blocking reads in child components to mix modes on a
            page.
        </li>
    </ul>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold">Try it</h2>
        <span
            class="rounded-full px-2 py-0.5 text-xs {loading
                ? 'bg-amber-100 text-amber-700'
                : 'bg-slate-100 text-slate-400'}">
            {loading ? 'fetching…' : 'idle'}
        </span>
    </div>
    <p class="mt-1 text-xs text-slate-500">
        Two <code class="font-mono">$derived(cache(getCounter)())</code> reads against the same key
        — both update together because they share one entry. The badge reads
        <code class="font-mono">pending(getCounter)</code>.
    </p>
    <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <div class="rounded-md border border-slate-200 p-3">
            <p class="text-xs text-slate-500">counter</p>
            {#await counter}
                <p class="mt-1 font-mono text-3xl text-slate-400">…</p>
            {:then data}
                <p class="mt-1 font-mono text-3xl text-slate-900">{data.count}</p>
            {:catch err}
                <p class="mt-1 font-mono text-sm text-red-600">{err.message}</p>
            {/await}
        </div>
        <div class="rounded-md border border-slate-200 p-3">
            <p class="text-xs text-slate-500">mirror</p>
            <p class="mt-1 font-mono text-3xl text-slate-900">{mirror.count}</p>
        </div>
    </div>
    <div class="mt-4 flex flex-wrap gap-2 text-sm">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={increment}>
            POST + invalidate
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={reset}>
            DELETE + invalidate
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => cache.invalidate({ scope: 'counter' })}>
            invalidate scope
        </button>
    </div>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="this page — two derivations share one entry"
        code={`import { cache } from '@belte/belte/shared/cache'
import { pending } from '@belte/belte/shared/pending'

const counter = $derived(cache(getCounter, { scope: 'counter' })())
const mirror  = $derived(await cache(getCounter, { scope: 'counter' })())  // same key, same entry
const loading = $derived(pending(getCounter))                              // standalone probe

async function increment() {
    await incrementCounter()
    cache.invalidate(getCounter)              // re-runs every subscriber
}`} />

    <CodeBlock
        title="option grammar"
        code={`cache(fn)()                             // cached until invalidated
cache(fn, { ttl: 0 })()                 // coalesce only — the mutation idiom
cache(fn, { ttl: 30_000 })()            // expire 30s after resolve
cache(fn, { scope: 'orders' })()        // tag for grouped invalidation/probing
cache(fn, { scope: ['orders', 'feed'] })()  // join several groups
cache(fn, { global: true })()           // process-level store (server reuse)
cache(fn, { invalidate: { throttle: 1000 } })()  // stale-while-revalidate (GET / pure-read only)

cache.invalidate()                      // drop everything
cache.invalidate(fn)                    // drop one function's calls
cache.invalidate({ scope: 'orders' })   // drop every entry sharing the tag

// loading state is the standalone probes — see /probes
import { pending } from '@belte/belte/shared/pending'
import { refreshing } from '@belte/belte/shared/refreshing'`} />
</section>
