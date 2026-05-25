<h1 class="text-3xl font-bold">Reply</h1>
<p class="mt-2 text-slate-600">
    What runs when a request lands. Response constructors with rpc-friendly defaults, the
    inbound request scope, the live server proxy, streaming wrappers, and the typed error
    path.
</p>

<section class="mt-8 grid gap-4 sm:grid-cols-2">
    <a
        href="/reply/response-helpers"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold"><code class="font-mono">belte/response</code></h2>
        <p class="mt-1 text-sm text-slate-600">
            <code class="font-mono">json</code>, <code class="font-mono">error</code>,
            <code class="font-mono">redirect</code> — Response constructors that default to
            <code class="font-mono">Cache-Control: no-store</code>.
        </p>
    </a>
    <a
        href="/reply/streaming-helpers"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold">Streaming helpers</h2>
        <p class="mt-1 text-sm text-slate-600">
            <code class="font-mono">sse(asyncIterable)</code>
            and <code class="font-mono">jsonl(asyncIterable)</code>
            — turn a generator into a streaming Response.
        </p>
    </a>
    <a
        href="/reply/request-and-server"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold"><code class="font-mono">request()</code> + <code class="font-mono">server</code></h2>
        <p class="mt-1 text-sm text-slate-600">
            AsyncLocalStorage-backed request scope and the stable
            <code class="font-mono">Bun.Server</code> proxy import.
        </p>
    </a>
    <a
        href="/reply/http-errors"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold"><code class="font-mono">HttpError</code> + cache headers</h2>
        <p class="mt-1 text-sm text-slate-600">
            404 / 405 / 500 with the framework's
            <code class="font-mono">no-store</code> defaults, and how
            <code class="font-mono">HttpError</code> bubbles up on the caller.
        </p>
    </a>
</section>
