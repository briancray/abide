<script lang="ts">
/*
Nested layout — wraps every page under src/pages/auth/. Composes after
the root layout (which already rendered the header chrome), so this just
adds an "auth area" frame around the children. Run on the server during
SSR and on the client during navigation, like every other layout.
*/
let { children }: { children: import('svelte').Snippet } = $props()
</script>

<section class="rounded-lg border border-slate-200 bg-white p-6">
    <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Auth area</p>
    <div class="mt-3">
        {@render children()}
    </div>
</section>
