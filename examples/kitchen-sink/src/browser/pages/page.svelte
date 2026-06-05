<script lang="ts">
/*
Kitchen-sink index. Six cards mirror the public umbrellas in the README —
belte/server, belte/shared, belte/browser, belte/mcp, belte/cli, belte/bundle.
The composed auth showcase sits below.
*/
</script>

<h1 class="text-3xl font-bold">belte kitchen-sink</h1>
<p class="mt-2 text-slate-600">
    Working demos of every primitive in the framework, organised by public umbrella — one typed
    backend reaching the browser, MCP, the CLI, and a native desktop bundle.
</p>

<section class="mt-8 grid gap-4 sm:grid-cols-2">
    <a
        href="/server"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold"><code class="font-mono">belte/server</code></h2>
        <p class="mt-1 text-sm text-slate-600">
            RPC verbs, sockets, response helpers, the request scope, the server proxy, and
            <code class="font-mono">HttpError</code>
            . Everything declared on the server side of an app.
        </p>
    </a>
    <a
        href="/shared"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold"><code class="font-mono">belte/shared</code></h2>
        <p class="mt-1 text-sm text-slate-600">
            The isomorphic surface — same callable both sides.
            <code class="font-mono">cache()</code> for deduped, SSR-hydrated reads, and
            <code class="font-mono">HttpError</code>
            for non-2xx remote calls.
        </p>
    </a>
    <a
        href="/browser"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold"><code class="font-mono">belte/browser</code></h2>
        <p class="mt-1 text-sm text-slate-600">
            How the browser reads, reacts, and navigates —
            <code class="font-mono">subscribe()</code>
            ,
            <code class="font-mono">page</code>
            , and
            <code class="font-mono">navigate</code>
            .
        </p>
    </a>
    <a href="/mcp" class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold"><code class="font-mono">belte/mcp</code></h2>
        <p class="mt-1 text-sm text-slate-600">
            Schema-bearing rpcs become MCP tools, with prompts and resources from
            <code class="font-mono">src/mcp/</code>
            , at
            <code class="font-mono">POST /__belte/mcp</code> — zero config.
        </p>
    </a>
    <a href="/cli" class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold"><code class="font-mono">belte/cli</code></h2>
        <p class="mt-1 text-sm text-slate-600">
            The thin standalone CLI binary — a remote client served from<code class="font-mono">
                /__belte/cli
            </code>
            ; schema-bearing rpcs auto-expose as commands.
        </p>
    </a>
    <a
        href="/bundle"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold"><code class="font-mono">belte/bundle</code></h2>
        <p class="mt-1 text-sm text-slate-600">
            <code class="font-mono">belte bundle</code> wraps the app in a movable, native desktop
            bundle — server binary, launcher, and OS webview, configured from
            <code class="font-mono">src/bundle/window.ts</code>
            .
        </p>
    </a>
</section>

<section class="mt-10 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-lg font-semibold">Composed showcase: cookie-session auth</h2>
    <p class="mt-1 text-sm text-slate-600">
        <a class="underline" href="/auth/dashboard">/auth/dashboard</a>
        is gated by a nested layout. The
        <code class="font-mono">auth/layout.svelte</code>
        <em>replaces</em>
        the root layout for everything under<code class="font-mono">/auth</code>
        (layouts are nearest-only), so the auth area renders its own chrome.
    </p>
</section>
