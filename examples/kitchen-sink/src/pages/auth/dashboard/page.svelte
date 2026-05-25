<script lang="ts">
import { cache } from 'belte/cache'
import { getSession } from '$rpc/getSession.ts'

/*
Shares the cache key with the root layout's `cache(getSession)()`, so the
session lookup happens once per request and both renders read the same
entry.
*/
const session = await cache(getSession)()
</script>

<h1 class="text-2xl font-bold">Dashboard</h1>
{#if session?.user}
    <p class="mt-3 text-sm text-slate-700">
        Hi, <strong>{session.user}</strong>. The root layout's session widget reads the same
        cache entry — one rpc call serves both.
    </p>
{:else}
    <p class="mt-3 text-sm text-slate-700">
        Not signed in.
        <a class="underline" href="/auth/login">Log in</a>
        to continue.
    </p>
{/if}
