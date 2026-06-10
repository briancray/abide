<script lang="ts">
import '../app.css'
import { navigate } from '@belte/belte/browser/navigate'
import { page } from '@belte/belte/browser/page'
import { onMenu } from '@belte/belte/bundle/onMenu'
import { cache } from '@belte/belte/shared/cache'
import { getSession } from '$server/rpc/getSession.ts'
import { logout } from '$server/rpc/logout.ts'

let { children }: { children: import('svelte').Snippet } = $props()

/*
Custom bundle menu items (declared in src/bundle/window.ts) carry no
arguments — clicking one fires the item's `emit` name through onMenu, the
app side of the contract that maps each name to real work. The name-filtered
form binds one handler per item; the catch-all form `onMenu((name) => …)`
takes every name through a single handler. onMenu is inert during SSR and in
a plain browser tab (the native menu only exists in the bundled desktop app);
returning its unsubscribe wires up $effect cleanup.
*/
$effect(() => onMenu('reload-session', () => location.reload()))
$effect(() => onMenu('open-mcp', () => void navigate('/mcp')))

/*
Top-level cache read — runs during SSR on the server and replays from
the cache snapshot on the client during hydration. Same line, both sides.
*/
const session = await cache(getSession)()

/*
`page.url` is reassigned on every SPA navigation, so reading it inside a
$derived re-runs without per-link plumbing. Active-link styling falls
out for free.
*/
const linkClass = (prefix: string) =>
    page.url.pathname === prefix || page.url.pathname.startsWith(`${prefix}/`)
        ? 'font-semibold text-slate-900'
        : 'text-slate-600 hover:text-slate-900'

/* Nav mirrors the README's section order — one entry per concept section. */
const sections = [
    ['/rpc', 'rpc'],
    ['/security', 'security'],
    ['/sockets', 'sockets'],
    ['/cache', 'cache'],
    ['/probes', 'pending / refreshing'],
    ['/pages', 'pages'],
    ['/url', 'url'],
    ['/tail', 'tail'],
    ['/agent', 'agent'],
    ['/mcp', 'mcp'],
    ['/cli', 'cli'],
    ['/bundle', 'bundle'],
] as const
</script>

<svelte:head>
    <title>belte kitchen-sink</title>
</svelte:head>

<div class="min-h-screen bg-slate-50 text-slate-900">
    <header class="border-b border-slate-200 bg-white">
        <nav
            class="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-1 px-6 py-4 text-sm">
            <a href="/" class="text-base font-semibold">belte kitchen-sink</a>
            {#each sections as [ href, label ] (href)}
                <a {href} class={linkClass(href)}>{label}</a>
            {/each}
            <a href="/auth/dashboard" class={linkClass('/auth')}>auth</a>
            <div class="ml-auto flex items-center gap-3">
                {#if session?.user}
                    <span class="text-slate-600">signed in as <strong>{session.user}</strong></span>
                    <form action={logout.url} method={logout.method}>
                        <button
                            type="submit"
                            class="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-100">
                            Log out
                        </button>
                    </form>
                {:else}
                    <a
                        href="/auth/login"
                        class="rounded-md bg-slate-900 px-3 py-1 text-white hover:bg-slate-700">
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
