<script lang="ts">
let { data }: { data: { error?: string } } = $props()
</script>

<h1 class="text-3xl font-bold">Log in</h1>
<p class="mt-2 text-slate-600">Any non-empty username works.</p>

<form method="post" class="mt-6 flex max-w-sm flex-col gap-3">
    <input
        name="username"
        placeholder="username"
        autocomplete="off"
        class="rounded-md border border-slate-300 px-3 py-2">
    {#if data.error}
        <p class="text-sm text-red-600">{data.error}</p>
    {/if}
    <button type="submit" class="rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700">
        Sign in
    </button>
</form>
