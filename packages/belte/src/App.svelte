<script lang="ts">
import type { AppState } from './lib/types/AppState.ts'

let { state }: { state: AppState } = $props()
let layouts = $derived.by(() => state.layouts)
let Page = $derived.by(() => state.Page)
let params = $derived.by(() => state.params)
let data = $derived.by(() => state.data)
</script>

{#snippet renderAt(index: number)}
    {#if index < layouts.length}
        {@const Layout = layouts[index].Component}
        <Layout {data}>
            {@render renderAt(index + 1)}
        </Layout>
    {:else if Page}
        {#key Page}
            <Page {...params} {data} />
        {/key}
    {/if}
{/snippet}

{@render renderAt(0)}
