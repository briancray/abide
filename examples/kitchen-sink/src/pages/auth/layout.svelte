<script lang="ts">
/*
Nested layout that REPLACES the root layout for every page under
src/pages/auth/. belte resolves the nearest matching layout.svelte and
ignores ancestors — the deepest wins, no stacking. That means this file
is responsible for everything the root would have rendered for the auth
subtree: the global stylesheet import, the head title, header chrome,
and the session widget.

Demonstrating the rule visibly: the auth pages get their own back-link
to "/" and their own session badge, distinct from the root layout's
nav. Switching between "/" and "/auth/login" you can see the chrome
change wholesale.
*/
import '../../app.css'
import { cache } from 'belte/browser'
import { getSession } from '$rpc/getSession.ts'
import { logout } from '$rpc/logout.ts'

let { children }: { children: import('svelte').Snippet } = $props()

const session = await cache(getSession)()
</script>

<svelte:head>
    <title>auth · belte kitchen-sink</title>
</svelte:head>

<div class="min-h-screen bg-slate-900 text-slate-100">
    <header class="border-b border-slate-700 bg-slate-950">
        <nav class="mx-auto flex max-w-4xl items-center gap-4 px-6 py-4 text-sm">
            <a href="/" class="text-base font-semibold text-slate-100">← back to kitchen-sink</a>
            <span class="text-xs uppercase tracking-wide text-slate-500">auth area</span>
            <div class="ml-auto flex items-center gap-3">
                {#if session?.user}
                    <span class="text-slate-400">
                        signed in as <strong class="text-slate-100">{session.user}</strong>
                    </span>
                    <form method="POST" action={logout.url}>
                        <button
                            type="submit"
                            class="rounded-md border border-slate-600 px-3 py-1 text-slate-100 hover:bg-slate-800">
                            Log out
                        </button>
                    </form>
                {:else}
                    <a
                        href="/auth/login"
                        class="rounded-md bg-slate-100 px-3 py-1 text-slate-900 hover:bg-slate-300">
                        Log in
                    </a>
                {/if}
            </div>
        </nav>
    </header>
    <main class="mx-auto max-w-4xl px-6 py-10">
        {@render children()}
    </main>
</div>
