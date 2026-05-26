<script lang="ts">
/*
Tiny reusable code-snippet card used by every demo page to show the
server (route handler) and client (caller) code that backs the demo.
`title` is a free-form label — usually a file path like `src/server/rpc/...`
or a phrase like `this page`. `code` is the raw source text.
*/
let { title, code }: { title?: string; code: string } = $props()
</script>

{#if title}
    <p class="mt-3 font-mono text-xs font-semibold text-slate-500">{title}</p>
{/if}
<pre class="mt-1 overflow-x-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-slate-100"><code>{code}</code></pre>
