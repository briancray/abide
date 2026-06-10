<script lang="ts">
import { url } from '@belte/belte/shared/url'
import CodeBlock from '$browser/CodeBlock.svelte'

/*
url(path, …) resolves three disjoint path kinds off the path itself:
  - an rpc path (/rpc/*) takes the verb's args, serialised to a query;
  - a page route ([id] segments) takes its params, then an optional query;
  - a bare asset / paramless path takes an optional query.
Scheme-qualified or protocol-relative URLs pass through untouched. When the
app mounts under APP_URL's subpath, every rooted internal result carries that
base — so links built here stay inside the mount with no per-link plumbing.
*/
let productId = $state('2')
let q = $state('shoes')

/* Live resolutions — recompute as the inputs change. */
const rpcHref = $derived(url('/rpc/getProduct', { id: productId }))
const searchHref = $derived(url('/rpc/getProduct', { q }))
const pageHref = $derived(url('/pages/product/[id]', { id: productId }))
const assetHref = $derived(url('/robots.txt'))
const externalHref = $derived(url('https://bun.sh', { utm: 'belte' }))
</script>

<h1 class="text-3xl font-bold"><code class="font-mono">url()</code></h1>
<p class="mt-2 text-slate-600">
    One typed, base-correct builder for every in-app URL — page links, asset refs, and rpc hrefs
    through a single chokepoint. It reads the path to pick a resolution: an
    <a class="underline" href="/rpc"><code class="font-mono">/rpc/*</code></a>
    path serialises the verb's args to a query, a
    <a class="underline" href="/pages"><code class="font-mono">[id]</code></a>
    route takes its params then an optional query, and a bare path takes an optional query.
</p>

<section class="mt-6">
    <h2 class="text-sm font-semibold">Three path kinds, resolved live</h2>
    <div
        class="mt-3 flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-white p-5">
        <label class="text-xs font-medium">
            id
            <input
                bind:value={productId}
                class="mt-1 block w-24 rounded-md border border-slate-300 px-3 py-1.5 text-sm">
        </label>
        <label class="text-xs font-medium">
            q
            <input
                bind:value={q}
                class="mt-1 block w-40 rounded-md border border-slate-300 px-3 py-1.5 text-sm">
        </label>
    </div>
    <div class="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">call</th>
                    <th class="px-4 py-2 font-medium">kind</th>
                    <th class="px-4 py-2 font-mono font-medium">result</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">{"url('/rpc/getProduct', { id })"}</td>
                    <td class="px-4 py-2 text-slate-600">rpc — args to query</td>
                    <td class="px-4 py-2 font-mono text-slate-900">{rpcHref}</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">{"url('/rpc/getProduct', { q })"}</td>
                    <td class="px-4 py-2 text-slate-600">rpc — any query key</td>
                    <td class="px-4 py-2 font-mono text-slate-900">{searchHref}</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">{"url('/pages/product/[id]', { id })"}</td>
                    <td class="px-4 py-2 text-slate-600">page — params interpolated</td>
                    <td class="px-4 py-2 font-mono text-slate-900">{pageHref}</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">{"url('/robots.txt')"}</td>
                    <td class="px-4 py-2 text-slate-600">asset — bare path</td>
                    <td class="px-4 py-2 font-mono text-slate-900">{assetHref}</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">{"url('https://bun.sh', { utm })"}</td>
                    <td class="px-4 py-2 text-slate-600">external — passes through</td>
                    <td class="px-4 py-2 font-mono text-slate-900">{externalHref}</td>
                </tr>
            </tbody>
        </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">
        A real link —
        <code class="font-mono">{"<a href={url('/pages/product/[id]', { id })}>"}</code>:
        <a class="underline" href={pageHref}>{pageHref}</a>
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Mounting under a subpath</h2>
    <p class="mt-1 text-xs text-slate-500">
        Set <code class="font-mono">APP_URL=https://app.com/v2</code> and every rooted result above
        gains the <code class="font-mono">/v2</code> base (the shell's
        <code class="font-mono">/_app/</code>
        asset refs carry it too), so internal links stay inside the mount. The server still routes
        at root — pair it with a proxy that strips the prefix. Scheme-qualified and
        protocol-relative URLs never gain the base.
    </p>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="this page — one helper, three path kinds"
        code={`import { url } from '@belte/belte/shared/url'

url('/rpc/getProduct', { id })          // /rpc/getProduct?id=2   — rpc args
url('/pages/product/[id]', { id })      // /pages/product/2       — page params
url('/robots.txt')                      // /robots.txt            — asset
url('https://bun.sh', { utm: 'belte' }) // untouched + ?utm=belte — external`} />
</section>
