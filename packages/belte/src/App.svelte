<script lang="ts">
import type { Component } from 'svelte'
import type { Page as PageState } from './lib/pages/page.svelte.ts'

let {
    state,
}: {
    state: {
        page: PageState
        render: { Layout: Component | undefined; Page: Component | undefined }
    }
} = $props()

let Layout = $derived(state.render.Layout)
let PageView = $derived(state.render.Page)
let params = $derived(state.page.params)
</script>

{#if Layout}
    <Layout>
        {#if PageView}
            {#key PageView}
                <PageView {...params} />
            {/key}
        {/if}
    </Layout>
{:else if PageView}
    {#key PageView}
        <PageView {...params} />
    {/key}
{/if}
