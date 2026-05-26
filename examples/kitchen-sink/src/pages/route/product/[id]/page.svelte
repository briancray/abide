<script lang="ts">
import CodeBlock from '$lib/CodeBlock.svelte'
import { cache } from 'belte/consume'
import { navigate } from 'belte/page'
import { HttpError } from 'belte/shared/HttpError'
import { getProduct } from '$route/getProduct.ts'

/*
The id prop comes from the [id] folder segment. It's typed via the
generated Routes augmentation at src/.belte/routes.d.ts — the same
shape as `page.params` for this route.
*/
let { id }: { id: string } = $props()

/*
cache(fn, { key: [...] }) scopes the entry per id, so two products don't
share a single getProduct entry. Wrapping `await` in $derived re-runs the
read when id changes (clicking 1 → 2 without remounting the page).
*/
const product = $derived(
    await cache(getProduct, { key: ['product', id] })({ id }).catch((err) => {
        if (err instanceof HttpError && err.status === 404) {
            return undefined
        }
        throw err
    }),
)
</script>

<h1 class="text-3xl font-bold">Product {id}</h1>
{#if product}
    <p class="mt-3 text-slate-700">
        <strong>{product.name}</strong> — €{product.price}
    </p>
{:else}
    <p class="mt-3 text-slate-500">No product with id {id}.</p>
{/if}

<div class="mt-6 flex flex-wrap gap-2 text-sm">
    {#each ['1', '2', '3'] as candidate (candidate)}
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => navigate(`/route/product/${candidate}`)}>
            navigate to /route/product/{candidate}
        </button>
    {/each}
</div>

<CodeBlock
    title="src/route/getProduct.ts (server) — id arrives as an arg, NOT a path segment"
    code={`import { GET } from 'belte/route'
import { json, error } from 'belte/respond'

const products: Record<string, { id: string; name: string; price: number }> = {
    '1': { id: '1', name: 'Stroopwafel', price: 4 },
    '2': { id: '2', name: 'Speculaas', price: 3 },
}

export const getProduct = GET<{ id: string }>(({ id }) => {
    const product = products[id]
    if (!product) return error(404, \`no product with id \${id}\`)
    return json(product)
})`} />

<CodeBlock
    title="src/pages/route/product/[id]/page.svelte (this page) — [id] is the dynamic page segment"
    code={`<script lang="ts">
import { cache } from 'belte/consume'
import { getProduct } from '$route/getProduct.ts'

/* id is generated into src/.belte/routes.d.ts and typed via Routes */
let { id }: { id: string } = $props()

/* per-id cache entry; $derived re-runs on navigation between ids */
const product = $derived(await cache(getProduct, { key: ['product', id] })({ id }))
</script>`} />

<p class="mt-6 text-sm text-slate-500">
    Note: page URLs can have <code class="font-mono">[id]</code>
    segments (they map to <code class="font-mono">:id</code>
    path params); route URLs cannot — pass identifiers via args. See
    <a class="underline" href="/route/verb-rpcs">verb-rpcs</a>
    for the route-side convention.
</p>
