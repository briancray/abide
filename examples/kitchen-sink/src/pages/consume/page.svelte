<script lang="ts">
import { page, navigate } from 'belte/page'

const currentPath = $derived(page.url.pathname)
</script>

<h1 class="text-3xl font-bold">Consume</h1>
<p class="mt-2 text-slate-600">
    How the client reads, reacts, and navigates. Direct calls for one-shot work,
    <code class="font-mono">cache()</code>
    for shared reads with SSR hydration, <code class="font-mono">subscribe()</code>
    for live streams, and <code class="font-mono">.raw</code> when you need the
    underlying Response.
</p>

<section class="mt-8 grid gap-4 sm:grid-cols-2">
    <a
        href="/consume/direct-calls"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold">Direct calls</h2>
        <p class="mt-1 text-sm text-slate-600">
            <code class="font-mono">await getX()</code>, plus
            <code class="font-mono">fn.url</code>
            for forms and plain <code class="font-mono">fetch</code>.
        </p>
    </a>
    <a
        href="/consume/cache"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold"><code class="font-mono">cache()</code> + invalidation</h2>
        <p class="mt-1 text-sm text-slate-600">
            Dedupe, SSR hydration, and reactive reads via
            <code class="font-mono">$derived(cache(fn)())</code>.
        </p>
    </a>
    <a
        href="/consume/raw-escape"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold"><code class="font-mono">.raw</code> escape hatch</h2>
        <p class="mt-1 text-sm text-slate-600">
            Need headers, status, or the body stream? Every remote function has a
            <code class="font-mono">.raw</code>
            sibling.
        </p>
    </a>
    <a
        href="/consume/subscribe"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold"><code class="font-mono">subscribe()</code> + <code class="font-mono">.stream</code></h2>
        <p class="mt-1 text-sm text-slate-600">
            Reactive streams against SSE, JSONL, and SOCKET rpcs — same call site, same
            iteration shape.
        </p>
    </a>
</section>

<section class="mt-10 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold"><code class="font-mono">page</code> + <code class="font-mono">navigate</code></h2>
    <p class="mt-1 text-sm text-slate-600">
        <code class="font-mono">page</code> is reactive — reading
        <code class="font-mono">page.url.pathname</code>
        inside a $derived (as this section does) subscribes the scope, so the value below
        updates the moment <code class="font-mono">navigate()</code>
        fires.
    </p>
    <p class="mt-3 font-mono text-sm text-slate-700">
        page.url.pathname = <strong>{currentPath}</strong>
    </p>
    <div class="mt-3 flex flex-wrap gap-2 text-sm">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => navigate('/consume/direct-calls')}>
            navigate('/consume/direct-calls')
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => navigate('/consume', { replace: true })}>
            navigate('/consume', {`{ replace: true }`})
        </button>
    </div>
</section>
