<h1 class="text-3xl font-bold">Route</h1>
<p class="mt-2 text-slate-600">
    How code <em>gets registered</em> with the framework. Folder-system routing turns files into
    URLs; verb-named imports turn handlers into typed remote functions.
</p>

<section class="mt-8 grid gap-4 sm:grid-cols-2">
    <a
        href="/route/verb-rpcs"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold">Verb-bound routes</h2>
        <p class="mt-1 text-sm text-slate-600">
            <code class="font-mono">GET / POST / PUT / PATCH / DELETE / HEAD</code>
            — one file per URL, one import per verb.
        </p>
    </a>
    <a
        href="/route/socket-rpc"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold">SOCKET routes</h2>
        <p class="mt-1 text-sm text-slate-600">
            Async-generator handlers multiplexed onto one framework-owned websocket at
            <code class="font-mono">/__belte/socket</code>.
        </p>
    </a>
    <a
        href="/route/product/1"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold">Dynamic segments</h2>
        <p class="mt-1 text-sm text-slate-600">
            <code class="font-mono">src/pages/route/product/[id]/page.svelte</code>
            — the
            <code class="font-mono">id</code> param is typed via the generated
            <code class="font-mono">Routes</code> augmentation.
        </p>
    </a>
    <a
        href="/auth/dashboard"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold">Nested layouts (replace, not stack)</h2>
        <p class="mt-1 text-sm text-slate-600">
            <code class="font-mono">src/pages/auth/layout.svelte</code>
            <em>replaces</em>
            the root layout for every page under
            <code class="font-mono">/auth</code>. Layouts are nearest-only — the deepest one wins.
        </p>
    </a>
</section>
