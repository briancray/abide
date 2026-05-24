<script lang="ts">
import type { AppState } from './lib/types/AppState.ts'

let { state }: { state: AppState } = $props()
let Layout = $derived(state.layout)
let Page = $derived(state.Page)
let params = $derived(state.params)
</script>

{#if Layout}
    <Layout>
        {#if Page}
            {#key Page}
                <Page {...params} />
            {/key}
        {/if}
    </Layout>
{:else if Page}
    {#key Page}
        <Page {...params} />
    {/key}
{/if}
