<script lang="ts">
import { navigate } from '@belte/belte/browser/navigate'
import { page } from '@belte/belte/browser/page'

const currentPath = $derived(page.url.pathname)
</script>

<h1 class="text-3xl font-bold"><code class="font-mono">belte/browser</code></h1>
<p class="mt-2 text-slate-600">
    The html consumer surface — direct calls for one-shot work,
    <code class="font-mono">tail()</code>
    for live streams, plus <code class="font-mono">page</code> and
    <code class="font-mono">navigate</code>
    for SPA routing. Shared, SSR-hydrated reads use
    <a class="underline" href="/shared/cache"><code class="font-mono">cache()</code></a>
    from <code class="font-mono">belte/shared</code>.
</p>

<section class="mt-8 grid gap-4 sm:grid-cols-2">
    <a
        href="/browser/direct-calls"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold">Direct calls</h2>
        <p class="mt-1 text-sm text-slate-600">
            <code class="font-mono">await getX()</code>, plus
            <code class="font-mono">fn.url</code>
            and <code class="font-mono">fn.method</code>
            for forms and plain <code class="font-mono">fetch</code>.
        </p>
    </a>
    <a
        href="/browser/tail"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold"><code class="font-mono">tail()</code></h2>
        <p class="mt-1 text-sm text-slate-600">
            Reactive consumer for streams — a socket, or any
            <code class="font-mono">fn.stream(args)</code>. Read the latest frame, or a live window
            of the last n, inside any
            <code class="font-mono">$derived</code>.
        </p>
    </a>
    <a
        href="/server/raw-stream"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold">
            <code class="font-mono">.raw</code>
            + <code class="font-mono">.stream</code>
        </h2>
        <p class="mt-1 text-sm text-slate-600">
            Every rpc has two siblings on its value — documented under
            <code class="font-mono">belte/server</code>
            → RPC, since the shape belongs to the declaration.
        </p>
    </a>
</section>

<section class="mt-10 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">
        <code class="font-mono">page</code>
        + <code class="font-mono">navigate</code>
    </h2>
    <p class="mt-1 text-sm text-slate-600">
        <code class="font-mono">page</code>
        is reactive — reading
        <code class="font-mono">page.url.pathname</code>
        inside a $derived (as this section does) subscribes the scope, so the value below updates
        the moment <code class="font-mono">navigate()</code>
        fires.
    </p>
    <p class="mt-3 font-mono text-sm text-slate-700">
        page.url.pathname = <strong>{currentPath}</strong>
    </p>
    <div class="mt-3 flex flex-wrap gap-2 text-sm">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => navigate('/browser/direct-calls')}>
            navigate('/browser/direct-calls')
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => navigate('/browser', { replace: true })}>
            navigate('/browser',{`{ replace: true }`}
            )
        </button>
    </div>
</section>
