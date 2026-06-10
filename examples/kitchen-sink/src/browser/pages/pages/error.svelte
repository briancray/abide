<script lang="ts">
/*
Failure boundary for the /pages subtree — the nearest error.svelte ancestor
wins (nearest-only, like layouts). Rendered in place of the page for an
unknown route (404) or a throw during a page render (500), with
{ status, message, stack } props. The full message and stack reach the
browser only where this template renders them.
*/
let { status, message }: { status: number; message: string; stack?: string } = $props()
</script>

<h1 class="text-3xl font-bold text-red-700">{status}</h1>
<p class="mt-2 text-slate-600">
    Caught by <code class="font-mono">src/browser/pages/pages/error.svelte</code> — the nearest
    failure boundary for this subtree.
</p>
<pre
    class="mt-4 overflow-x-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-red-200"><code
    >{message}</code></pre>
<p class="mt-4 text-sm"><a class="underline" href="/pages">← back to Pages</a></p>
