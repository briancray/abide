<h1 class="text-3xl font-bold"><code class="font-mono">belte/server</code></h1>
<p class="mt-2 text-slate-600">
    Everything declared on the server: HTTP-verb rpcs, isomorphic sockets, response helpers,
    the <code class="font-mono">request()</code> / <code class="font-mono">server()</code>
    accessors, and <code class="font-mono">HttpError</code>.
</p>

<section class="mt-8 grid gap-4 sm:grid-cols-2">
    <a
        href="/server/rpc"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold">RPC</h2>
        <p class="mt-1 text-sm text-slate-600">
            One file per rpc under <code class="font-mono">src/server/rpc/</code>. The verb is
            the import (<code class="font-mono">GET</code> / <code class="font-mono">POST</code>
            / <code class="font-mono">PUT</code> / <code class="font-mono">PATCH</code> /
            <code class="font-mono">DELETE</code> / <code class="font-mono">HEAD</code>),
            filename = export name = URL path.
        </p>
    </a>
    <a
        href="/server/sockets"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold">Sockets</h2>
        <p class="mt-1 text-sm text-slate-600">
            Named broadcast topics under <code class="font-mono">src/server/sockets/</code>,
            multiplexed onto one framework-owned ws.
        </p>
    </a>
    <a
        href="/server/raw-stream"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold"><code class="font-mono">.raw</code> and <code class="font-mono">.stream(args?)</code></h2>
        <p class="mt-1 text-sm text-slate-600">
            Function-shape siblings on every rpc — raw <code class="font-mono">Response</code>
            access, plus iteration over SSE/JSONL frames.
        </p>
    </a>
    <a
        href="/server/respond"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold">Response helpers</h2>
        <p class="mt-1 text-sm text-slate-600">
            <code class="font-mono">json</code> / <code class="font-mono">error</code> /
            <code class="font-mono">redirect</code>, plus <code class="font-mono">sse</code>
            and <code class="font-mono">jsonl</code> for streaming.
        </p>
    </a>
    <a
        href="/server/streaming"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold">SSE + JSONL</h2>
        <p class="mt-1 text-sm text-slate-600">
            One-shot streaming over plain HTTP — yield from an async generator, the framework
            wraps it as <code class="font-mono">text/event-stream</code> or
            <code class="font-mono">application/jsonl</code>.
        </p>
    </a>
    <a
        href="/server/request"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold"><code class="font-mono">request()</code> + <code class="font-mono">server()</code></h2>
        <p class="mt-1 text-sm text-slate-600">
            Per-request access (backed by <code class="font-mono">AsyncLocalStorage</code>) and
            the live <code class="font-mono">Bun.Server</code> handle.
        </p>
    </a>
    <a
        href="/server/http-errors"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold"><code class="font-mono">HttpError</code></h2>
        <p class="mt-1 text-sm text-slate-600">
            Thrown by rpc calls on non-2xx. Same type on the wire and in the catch — carries
            <code class="font-mono">status</code>, <code class="font-mono">statusText</code>,
            and the raw <code class="font-mono">response</code>.
        </p>
    </a>
</section>
