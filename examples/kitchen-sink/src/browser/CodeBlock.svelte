<script lang="ts">
import { cache } from 'belte/browser/cache'
import { highlightCode } from '$server/rpc/highlightCode.ts'

/*
Tiny reusable code-snippet card used by every demo page to show the
server (route handler) and client (caller) code that backs the demo.
`title` is a free-form label — usually a file path like `src/server/rpc/...`
or a phrase like `this page`. `code` is the raw source text. `lang`
picks the shiki grammar; defaults to TypeScript.

Highlighting runs on the server via the highlightCode rpc — shiki
never reaches the browser bundle. cache() captures the rendered HTML
into the SSR snapshot so hydration is one shot; subsequent SPA navs
re-fetch through the regular HTTP path. Identical code+lang across
pages share one cache entry.
*/
type Lang = 'ts' | 'svelte' | 'sh'
let { title, code, lang = 'ts' }: { title?: string; code: string; lang?: Lang } = $props()

const { html } = await cache(highlightCode)({ code, lang })
</script>

{#if title}
    <p class="mt-3 font-mono text-xs font-semibold text-slate-500">{title}</p>
{/if}
<div class="codeblock mt-1 overflow-x-auto rounded-md text-xs leading-relaxed">{@html html}</div>

<style>
.codeblock :global(pre.shiki) {
    padding: 1rem;
    margin: 0;
}
</style>
