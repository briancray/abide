<script lang="ts">
type LayoutEntry = { key: string; Component: any }
type State = {
    layouts: LayoutEntry[]
    Page: any
    params: Record<string, string>
    data: Record<string, unknown>
}

let { state }: { state: State } = $props()
let layouts = $derived.by(() => state.layouts)
let Page = $derived.by(() => state.Page)
let params = $derived.by(() => state.params)
let data = $derived.by(() => state.data)
</script>

{#snippet renderAt(idx: number)}
  {#if idx < layouts.length}
    {@const L = layouts[idx].Component}
    <L {data}>
      {@render renderAt(idx + 1)}
    </L>
  {:else if Page}
    {#key Page}
      <Page {...params} {data} />
    {/key}
  {/if}
{/snippet}

{@render renderAt(0)}
