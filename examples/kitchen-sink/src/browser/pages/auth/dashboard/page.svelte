<script lang="ts">
import { cache } from '@briancray/belte/browser/cache'
import { getSession } from '$server/rpc/getSession.ts'

/*
Shares the cache key with the auth layout's `cache(getSession)()`, so the
session lookup happens once per request and both renders read the same
entry.
*/
const session = await cache(getSession)()
</script>

<h1 class="text-2xl font-bold">Dashboard</h1>
{#if session?.user}
    <p class="mt-3 text-sm text-slate-300">
        Hi, <strong>{session.user}</strong>. The auth layout's session widget reads the same
        cache entry as this page — one route call serves both.
    </p>
{:else}
    <p class="mt-3 text-sm text-slate-300">
        Not signed in.
        <a class="underline" href="/auth/login">Log in</a>
        to continue.
    </p>
{/if}

<p class="mt-6 text-xs text-slate-500">
    Layouts are nearest-only: <code class="font-mono">src/browser/pages/auth/layout.svelte</code>
    replaces <code class="font-mono">src/browser/pages/layout.svelte</code> for everything under
    <code class="font-mono">/auth</code>. Navigate back to
    <a class="underline" href="/">the root</a> to see the chrome change wholesale.
</p>
