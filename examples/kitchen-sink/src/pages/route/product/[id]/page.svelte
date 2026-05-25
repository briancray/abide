<script lang="ts">
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

<p class="mt-6 text-sm text-slate-500">
    Source: <code class="font-mono">src/pages/route/product/[id]/page.svelte</code>
</p>
