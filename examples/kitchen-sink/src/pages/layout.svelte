<script lang="ts">
import '../app.css'
import { cache } from 'belte/cache'
import { nav } from 'belte/nav'
import { getSession } from '$rpc/getSession'
import { logout } from '$rpc/logout'

let { children }: { children: any } = $props()

const session = await cache(getSession)().then((res) => res.json())

/*
`nav.pathname` is reactive and synced from window.location on every SPA
navigation, so derivations based on it (like "is this link active?") re-run
without any per-link plumbing.
*/
const linkClass = (href: string) =>
    nav.pathname === href
        ? 'font-medium text-slate-900'
        : 'text-slate-600 hover:text-slate-900'
</script>

<svelte:head>
    <title>kitchen-sink</title>
</svelte:head>

<div class="min-h-screen bg-slate-50 text-slate-900">
    <header class="border-b border-slate-200 bg-white">
        <nav class="mx-auto flex max-w-3xl items-center gap-4 px-6 py-4">
            <a href="/" class="font-semibold">kitchen-sink</a>
            <a href="/" class={linkClass('/')}>Home</a>
            <a href="/about" class={linkClass('/about')}>About</a>
            <a href="/dashboard" class={linkClass('/dashboard')}>Dashboard</a>
            <a href="/counter" class={linkClass('/counter')}>Counter</a>
            <div class="ml-auto flex items-center gap-3 text-sm">
                {#if session?.user}
                    <span class="text-slate-600">
                        signed in as <strong>{session?.user}</strong>
                    </span>
                    <form method="POST" action={logout.url}>
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
