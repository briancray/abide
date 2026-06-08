<script lang="ts">
import { navigate } from '@belte/belte/browser/navigate'
import { cache } from '@belte/belte/shared/cache'
import { HttpError } from '@belte/belte/shared/HttpError'
import CodeBlock from '$browser/CodeBlock.svelte'
import { getProduct } from '$server/rpc/getProduct.ts'

let { id }: { id: string } = $props()

const product = $derived(
    await cache(getProduct)({ id }).catch((err) => {
        if (err instanceof HttpError && err.status === 404) return undefined
        throw err
    }),
)
</script>

<nav class="mb-2 text-sm text-slate-500">
    <a href="/server" class="hover:text-slate-900"><code class="font-mono">belte/server</code></a>
    <span class="mx-2">/</span>
    <a href="/server/rpc" class="hover:text-slate-900">RPC</a>
    <span class="mx-2">/</span>
    <span>Product{id}</span>
</nav>
<h1 class="text-3xl font-bold">Product{id}</h1>
<p class="mt-2 text-slate-600">
    Dynamic page segment<code class="font-mono">[id]</code> from the folder name — typed via the
    generated<code class="font-mono">Routes</code> augmentation. The cache key folds in the call
    args, so each id gets its own entry;<code class="font-mono">$derived</code> re-runs on nav.
</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    {#if product}
        <p class="text-slate-700"><strong>{product.name}</strong> — €{product.price}</p>
    {:else}
        <p class="text-slate-500">No product with id{id}.</p>
    {/if}
    <div class="mt-4 flex flex-wrap gap-2 text-sm">
        {#each ['1', '2', '3'] as candidate (candidate)}
            <button
                type="button"
                class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
                onclick={() => navigate(`/server/rpc/product/${candidate}`)}>
                navigate to /product/{candidate}
            </button>
        {/each}
    </div>
</section>

<section class="mt-6">
    <h2 class="text-sm font-semibold">Page segments vs rpc args</h2>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-medium">file</th>
                    <th class="px-4 py-2 font-medium">dynamic shape</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">src/browser/pages/.../[id]/page.svelte</td>
                    <td class="px-4 py-2 text-slate-600">
                        URL segment →<code class="font-mono">$props().id</code>
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">src/server/rpc/&lt;name&gt;.ts</td>
                    <td class="px-4 py-2 text-slate-600">
                        flat URL — pass identifiers via args (<code class="font-mono">
                            fn({`{ id }`}
                            )
                        </code>
                        )
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="src/server/rpc/getProduct.ts"
        code={`import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'
import { error } from '@belte/belte/server/error'

export const getProduct = GET<{ id: string }>(({ id }) => {
    const product = products[id]
    if (!product) return error(404, \`no product with id \${id}\`)
    return json(product)
})`} />

    <CodeBlock
        title="this page — [id] segment + per-id cache"
        lang="svelte"
        code={`<script lang="ts">
import { cache } from '@belte/belte/shared/cache'
import { getProduct } from '$server/rpc/getProduct.ts'

let { id }: { id: string } = $props()    // typed via src/.belte/routes.d.ts

// the key folds in { id }, so each product gets its own entry
const product = $derived(await cache(getProduct)({ id }))
</script>`} />
</section>
