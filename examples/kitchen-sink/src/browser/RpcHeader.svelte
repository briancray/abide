<script lang="ts">
import { page } from '@belte/belte/browser/page'

/*
Section masthead for every rpc page — the index and each /rpc/* subpage
render it so the title, intro, and pill nav read identically across the
section, not just on the overview. A nested layout.svelte can't do this:
belte resolves the deepest layout and drops the root, so it'd swap out the
top-level chrome instead of nesting under it. A shared component composes
inside the root layout instead.

Active state reads page.url.pathname, so it re-highlights on every SPA nav
for free. The overview tab matches exactly; the rest can't collide since
each is a distinct path.
*/
const subpages = [
    ['/rpc', 'overview'],
    ['/rpc/consume', 'consume'],
    ['/rpc/errors', 'HttpError'],
    ['/rpc/respond', 'response helpers'],
    ['/rpc/streaming', 'jsonl / sse'],
    ['/rpc/request-scope', 'request scope'],
] as const

const pillClass = (href: string) =>
    page.url.pathname === href
        ? 'rounded-full bg-slate-900 px-3 py-1 text-white'
        : 'rounded-full border border-slate-300 bg-white px-3 py-1 text-slate-600 hover:bg-slate-100'
</script>

<h1 class="text-3xl font-bold">rpc</h1>
<p class="mt-2 text-slate-600">
    One file per rpc under <code class="font-mono">src/server/rpc/</code>. Filename = export name =
    URL path under <code class="font-mono">/rpc/</code>; the imported verb (<code class="font-mono"
        >GET</code
    >
    / <code class="font-mono">POST</code>
    / <code class="font-mono">PUT</code>
    / <code class="font-mono">PATCH</code>
    / <code class="font-mono">DELETE</code>
    / <code class="font-mono">HEAD</code>, each its own import) picks the HTTP method. Args ride the
    query string (GET/DELETE/HEAD) or the JSON/form body (POST/PUT/PATCH); body wins on collision.
</p>
<nav class="mt-4 flex flex-wrap gap-2 text-sm">
    {#each subpages as [ href, label ] (href)}
        <a {href} class={pillClass(href)}>{label}</a>
    {/each}
</nav>
