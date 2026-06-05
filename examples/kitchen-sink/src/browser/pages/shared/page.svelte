<script lang="ts">
/*
belte/shared umbrella overview. The isomorphic surface — names that are the
same callable with the same behaviour on both sides; the bundler doesn't swap
them per target. Mirrors the README's "Clients → Shared" section: cache() and
HttpError.
*/
</script>

<h1 class="text-3xl font-bold"><code class="font-mono">belte/shared</code></h1>
<p class="mt-2 text-slate-600">
    The isomorphic surface — same callable, same behaviour on server and client. Sits between
    <code class="font-mono">belte/server</code> (server-only) and
    <code class="font-mono">belte/browser</code>
    (client-only).
</p>

<section class="mt-8 grid gap-4 sm:grid-cols-2">
    <a
        href="/shared/cache"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold"><code class="font-mono">cache()</code> + invalidation</h2>
        <p class="mt-1 text-sm text-slate-600">
            Dedupe, SSR hydration, and reactive reads via
            <code class="font-mono">$derived(cache(fn)())</code>
            . One line that blocks during SSR and replays from the snapshot on the client.
        </p>
    </a>
    <a
        href="/server/http-errors"
        class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
        <h2 class="text-lg font-semibold"><code class="font-mono">HttpError</code></h2>
        <p class="mt-1 text-sm text-slate-600">
            Thrown by a plain remote call on any non-2xx; carries
            <code class="font-mono">status</code> and the raw
            <code class="font-mono">response</code>
            . Shown end-to-end with the
            <code class="font-mono">error()</code> helper under
            <code class="font-mono">belte/server</code> → http-errors.
        </p>
    </a>
</section>
