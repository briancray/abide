<script lang="ts">
import { health } from '@belte/belte/shared/health'
import { online } from '@belte/belte/shared/online'
import CodeBlock from '$browser/CodeBlock.svelte'

/*
Both reads are reactive: the $derived re-runs when the browser's
online/offline events fire (online) or a poll lands with news (health).
Reading health() is what opens the poll — the first tracking reader starts
it, the last one tears it down, so a page that never reads it never sends
a byte. And because this read also ran during SSR, the payload rode the
document: hydration seeds from __SSR__ and the first poll waits a full
interval instead of re-probing the server that just responded.
*/
const connected = $derived(online())
const backend = $derived(health())
</script>

<h1 class="text-3xl font-bold">
    <code class="font-mono">online()</code>
    / <code class="font-mono">health()</code>
</h1>
<p class="mt-2 text-slate-600">
    Reactive connectivity reads in the
    <a class="underline" href="/probes"><code class="font-mono">pending / refreshing</code></a>
    family. <code class="font-mono">online()</code> reports the browser's own network state;
    <code class="font-mono">health()</code>
    answers "can I reach <em>my</em> backend, and what does it say about me" — polled from
    <code class="font-mono">/__belte/health</code>
    only while a tracking scope reads it. Both are constant on the server (<code class="font-mono"
        >true</code
    >
    / <code class="font-mono">{`{ reachable: true }`}</code>): the server is its own backend.
</p>

<section class="mt-6 grid gap-4 sm:grid-cols-2">
    <div class="rounded-lg border border-slate-200 bg-white p-5">
        <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold"><code class="font-mono">online()</code></h2>
            <span
                class="rounded-full px-2 py-0.5 text-xs {connected
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-red-100 text-red-700'}">
                {connected ? 'online' : 'offline'}
            </span>
        </div>
        <p class="mt-1 text-xs text-slate-500">
            Rides the browser's <code class="font-mono">online</code>/<code class="font-mono"
                >offline</code
            >
            events — toggle your network (or devtools' offline mode) and watch it flip. The offline
            signal is reliable; the online one can false-positive behind a captive portal, which is
            exactly what
            <code class="font-mono">health()</code>
            exists to verify.
        </p>
    </div>
    <div class="rounded-lg border border-slate-200 bg-white p-5">
        <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold"><code class="font-mono">health()</code></h2>
            <span
                class="rounded-full px-2 py-0.5 text-xs {backend.reachable
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-red-100 text-red-700'}">
                {backend.reachable ? 'reachable' : 'unreachable'}
            </span>
        </div>
        <p class="mt-1 text-xs text-slate-500">
            The full <code class="font-mono">/__belte/health</code> payload plus
            <code class="font-mono">reachable</code>
            — framework identity and hook fields alike. This page read it during SSR, so the first
            value was seeded from the document (check the network tab: no probe at load); polls run
            every 10s while read, paused in hidden tabs, probed immediately when the tab returns or
            the network comes back.
            <code class="font-mono">reachable</code>
            composes with <code class="font-mono">navigator.onLine</code> at read time, so a lost
            network reports instantly. Stop the dev server to watch it flip.
        </p>
        <pre
            class="mt-3 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100"><code
            >{JSON.stringify(backend, undefined, 2)}</code></pre>
    </div>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">
        App fields — the <code class="font-mono">health</code>
        hook
    </h2>
    <p class="mt-1 text-xs text-slate-500">
        The extra keys above come from the <code class="font-mono">health(request)</code> hook in
        <code class="font-mono">src/app.ts</code>
        — this app reports
        <code class="font-mono">authenticated</code>
        from the session cookie (<a class="underline" href="/auth/login">log in</a> and watch it
        flip on the next poll). The endpoint answers ahead of all middleware — reporting
        "authenticated: false" requires exactly that — and the payload is public: never put secrets
        in it. The hook's resolved return types the read via the generated
        <code class="font-mono">AppHealth</code>, and the last-known fields persist while
        unreachable, so "was authenticated, currently unreachable" stays distinguishable from
        "reachable, not authenticated".
    </p>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="this page — both reads live"
        code={`import { online } from '@belte/belte/shared/online'
import { health } from '@belte/belte/shared/health'

const connected = $derived(online())  // browser online/offline events
// { reachable, authenticated, belte, name, version } — hook fields typed via AppHealth
const backend = $derived(health())`} />

    <CodeBlock
        title="src/app.ts — fields merged into /__belte/health"
        code={`export const health: AppModule['health'] = (request) => ({
    authenticated: sessionFromRequest(request) !== undefined,
})`} />

    <CodeBlock
        title="the wire — always unauthenticated, identity included"
        lang="sh"
        code={`curl -s http://localhost:3000/__belte/health
# { "authenticated": false, "belte": "<version>", "name": "kitchen-sink", "version": "0.0.0" }
# health() returns this payload whole, plus reachable; a page that reads
# health() during SSR ships it in __SSR__ as the hydration seed.
# /__belte/identity is the legacy alias (same payload, belte: true)`} />
</section>
