<script lang="ts">
import '../app.css'

let { data, children }: { data: { user?: string }; children: any } = $props()
</script>

<svelte:head>
    <title>kitchen-sink</title>
</svelte:head>

<div class="min-h-screen bg-slate-50 text-slate-900">
    <header class="border-b border-slate-200 bg-white">
        <nav class="mx-auto flex max-w-3xl items-center gap-4 px-6 py-4">
            <a href="/" class="font-semibold">kitchen-sink</a>
            <a href="/" class="text-slate-600 hover:text-slate-900">Home</a>
            <a href="/about" class="text-slate-600 hover:text-slate-900">About</a>
            <a href="/dashboard" class="text-slate-600 hover:text-slate-900">Dashboard</a>
            <div class="ml-auto flex items-center gap-3 text-sm">
                {#if data.user}
                    <span class="text-slate-600">signed in as <strong>{data.user}</strong></span>
                    <form method="post" action="/logout">
                        <button
                            type="submit"
                            class="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-100">
                            Log out
                        </button>
                    </form>
                {:else}
                    <a
                        href="/login"
                        class="rounded-md bg-slate-900 px-3 py-1 text-white hover:bg-slate-700">
                        Log in
                    </a>
                {/if}
            </div>
        </nav>
    </header>
    <main class="mx-auto max-w-3xl px-6 py-10">
        {@render children()}
    </main>
</div>
