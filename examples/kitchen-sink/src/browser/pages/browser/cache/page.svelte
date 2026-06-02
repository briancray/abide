<script lang="ts">
import { cache } from '@briancray/belte/browser/cache'
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

async function increment() {
    await incrementCounter()
    cache.invalidate(getCounter)
}

async function reset() {
    await resetCounter()
    cache.invalidate(getCounter)
}
</script>

<nav class="mb-2 text-sm text-slate-500">
    <a href="/browser" class="hover:text-slate-900"><code class="font-mono">belte/browser</code></a>
    <span class="mx-2">/</span>
    <span><code class="font-mono">cache()</code> + invalidation</span>
</nav>
<h1 class="text-3xl font-bold"><code class="font-mono">cache()</code> + invalidation</h1>
<p class="mt-2 text-slate-600">
    Wraps a remote call with dedupe, SSR snapshot, and reactivity. Two
    <code class="font-mono">$derived</code> reads against the same key share one entry and re-run
    together on invalidation.
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
                    <td class="px-4 py-2 text-slate-600">live forever (default)</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono text-slate-500">0</td>
                    <td class="px-4 py-2 text-slate-600">
                        dedupe in-flight only — drop once settled
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono text-slate-500">number (ms)</td>
                    <td class="px-4 py-2 text-slate-600">expire after resolve</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">key</td>
                    <td class="px-4 py-2 font-mono text-slate-500">string / unknown[] / object</td>
                    <td class="px-4 py-2 text-slate-600">
                        override the auto key — method + url + args (e.g.
                        <code class="font-mono">['post', id]</code>
                        )
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">scope</td>
                    <td class="px-4 py-2 font-mono text-slate-500">string / string[]</td>
                    <td class="px-4 py-2 text-slate-600">
                        one or more free-form tags grouping calls so one
                        <code class="font-mono">invalidate</code> drops them together; a call can
                        join several groups
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</section>

<section class="mt-6">
    <h2 class="text-sm font-semibold"><code class="font-mono">cache.invalidate</code></h2>
    <ul class="mt-2 space-y-1 text-sm text-slate-600">
        <li><code class="font-mono">cache.invalidate()</code> — drop everything</li>
        <li>
            <code class="font-mono">cache.invalidate(fn)</code> — drop one function's calls (fn or
            fn.raw)
        </li>
        <li>
            <code class="font-mono">{'cache.invalidate({ key?, scope? })'}</code> — drop a keyed
            entry and/or every entry in a scope (the union)
        </li>
    </ul>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Try it</h2>
    <p class="mt-1 text-xs text-slate-500">
        Two <code class="font-mono">$derived(cache(getCounter)())</code> reads against the same key
        — both update together because they share one entry.
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
        code={`import { cache } from '@briancray/belte/browser/cache'

const counter = $derived(cache(getCounter, { scope: 'counter' })())
const mirror  = $derived(await cache(getCounter, { scope: 'counter' })())  // same key, same entry

async function increment() {
    await incrementCounter()
    cache.invalidate(getCounter)              // re-runs every subscriber
}`} />

    <CodeBlock
        title="option grammar"
        code={`cache(fn)()                             // lives forever
cache(fn, { ttl: 0 })()                 // dedupe in-flight only
cache(fn, { ttl: 30_000 })()            // expire 30s after resolve
cache(fn, { key: 'group' })()           // group calls under one key
cache(fn, { key: ['post', id] })()      // override the key per arg
cache(fn, { scope: 'orders' })()        // tag for grouped invalidation
cache(fn, { scope: ['orders', 'feed'] })()  // join several groups

cache.invalidate()                      // drop everything
cache.invalidate(fn)                    // drop one function's calls
cache.invalidate({ key: ['post', id] }) // drop one keyed entry
cache.invalidate({ scope: 'orders' })   // drop every entry sharing the tag`} />
</section>
