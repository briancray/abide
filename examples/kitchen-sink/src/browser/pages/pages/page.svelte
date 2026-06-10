<script lang="ts">
import { navigate } from '@belte/belte/browser/navigate'
import { page } from '@belte/belte/browser/page'

/*
`page.url` is reassigned on every navigation, so reading it inside a
$derived re-runs the scope — no per-link plumbing.
*/
const currentPath = $derived(page.url.pathname)
const navigating = $derived(page.navigating)
</script>

<h1 class="text-3xl font-bold">Pages</h1>
<p class="mt-2 text-slate-600">
    Every folder under <code class="font-mono">src/browser/pages/</code> with a
    <code class="font-mono">page.svelte</code>
    is a route. <code class="font-mono">pages/post/[id]/page.svelte</code> →
    <code class="font-mono">/post/[id]</code>;
    <code class="font-mono">[...rest]</code>
    catches all.
    <code class="font-mono">layout.svelte</code>
    wraps its subtree — nearest ancestor only, no stacking — and
    <code class="font-mono">error.svelte</code>
    is the subtree's failure boundary.
</p>

<section class="mt-6">
    <div class="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-medium">demo</th>
                    <th class="px-4 py-2 font-medium">shows</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2">
                        <a class="underline" href="/pages/product/1">/pages/product/[id]</a>
                    </td>
                    <td class="px-4 py-2 text-slate-600">
                        a dynamic <code class="font-mono">[id]</code> segment, typed via the
                        generated <code class="font-mono">Routes</code> interface
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2">
                        <a class="underline" href="/auth/dashboard">/auth/dashboard</a>
                    </td>
                    <td class="px-4 py-2 text-slate-600">
                        nearest-only layouts — <code class="font-mono">auth/layout.svelte</code>
                        replaces the root layout for its subtree
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2">
                        <a class="underline" href="/pages/boundary?explode=1">
                            /pages/boundary?explode=1
                        </a>
                    </td>
                    <td class="px-4 py-2 text-slate-600">
                        <code class="font-mono">error.svelte</code>
                        catching a render throw — the nearest boundary renders with
                        <code class="font-mono">{'{ status, message, stack }'}</code>
                        props
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2">
                        <a class="underline" href="/pages/no-such-page">/pages/no-such-page</a>
                    </td>
                    <td class="px-4 py-2 text-slate-600">
                        the same boundary rendering an unknown route as a 404
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">
        <code class="font-mono">page</code>
        + <code class="font-mono">navigate</code>
    </h2>
    <p class="mt-1 text-sm text-slate-600">
        <code class="font-mono">page</code>
        is reactive page state — <code class="font-mono">route</code>,
        <code class="font-mono">params</code>, <code class="font-mono">url</code>,
        <code class="font-mono">navigating</code>. Same-pathname navigations (search/hash) skip the
        fetch and remount; non-SPA targets fall back to a hard navigation.
    </p>
    <p class="mt-3 font-mono text-sm text-slate-700">
        page.url.pathname = <strong>{currentPath}</strong>
        {#if navigating}
            <span class="text-amber-600">(navigating…)</span>
        {/if}
    </p>
    <div class="mt-3 flex flex-wrap gap-2 text-sm">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => navigate('/pages/product/1')}>
            navigate('/pages/product/1')
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => navigate('/pages', { replace: true })}>
            navigate('/pages',{`{ replace: true }`}
            )
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => navigate(`/pages?ts=${Date.now()}`, { scroll: false })}>
            same pathname — no fetch, no remount
        </button>
    </div>
</section>

<section class="mt-6 space-y-3 text-sm text-slate-600">
    <pre
        class="overflow-x-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-slate-100"><code
        >{`import { page } from '@belte/belte/browser/page'         // route, params, url, navigating
import { navigate } from '@belte/belte/browser/navigate'

await navigate('/pages/product/1')                        // opts: { replace, scroll }`}</code></pre>
</section>
