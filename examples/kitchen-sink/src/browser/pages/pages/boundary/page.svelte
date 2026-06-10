<script lang="ts">
import { page } from '@belte/belte/browser/page'

/*
Throws during render when ?explode is present — exercising the nearest
error.svelte ancestor (pages/error.svelte), which renders with
{ status, message, stack } props in place of this page.
*/
if (page.url.searchParams.has('explode')) {
    throw new Error('intentional render throw — exercising error.svelte')
}
</script>

<nav class="mb-2 text-sm text-slate-500">
    <a href="/pages" class="hover:text-slate-900">Pages</a>
    <span class="mx-2">/</span>
    <span>boundary</span>
</nav>
<h1 class="text-3xl font-bold">Failure boundary</h1>
<p class="mt-2 text-slate-600">
    This page renders normally — until it throws. The nearest
    <code class="font-mono">error.svelte</code>
    ancestor (here <code class="font-mono">pages/error.svelte</code>, nearest-only like layouts)
    takes over for the subtree.
</p>
<div class="mt-4 flex flex-wrap gap-2 text-sm">
    <a
        href="/pages/boundary?explode=1"
        class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100">
        throw during render → error.svelte (500)
    </a>
    <a
        href="/pages/no-such-page"
        class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100">
        unknown route → error.svelte (404)
    </a>
</div>
