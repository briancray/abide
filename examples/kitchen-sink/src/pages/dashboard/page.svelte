<script lang="ts">
import { cache } from 'belte/cache'
import { getSession } from '$rpc/getSession.ts'

const session = await cache(getSession)().then((res) => res.json())
</script>

<h1 class="text-3xl font-bold">Dashboard</h1>
{#if session?.user}
    <p class="mt-2 text-slate-600">Hi, <strong>{session?.user}</strong>. Welcome back.</p>
{:else}
    <p class="mt-2 text-slate-600">Not signed in. <a class="underline" href="/login">Log in</a>.</p>
{/if}
