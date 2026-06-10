<script lang="ts">
/*
Kitchen-sink index. One card per README concept section, in the README's
order — rpc, Security defaults, Sockets, cache, pending / refreshing,
Pages, url, tail, agent, MCP / CLI / bundle. The composed auth showcase
sits below.
*/
const cards = [
    {
        href: '/rpc',
        title: 'rpc',
        body: 'One verb per file under src/server/rpc/ — GET / POST / PUT / PATCH / DELETE / HEAD. The schema validates args and projects the MCP tool, CLI flags, and OpenAPI operation from one declaration.',
    },
    {
        href: '/security',
        title: 'Security defaults',
        body: 'Mutating verbs 403 a cross-origin browser Origin before the handler runs; crossOrigin: true is the per-verb opt-out. /__belte/mcp gets the same check, and boot warns when MCP tools ship with no auth middleware.',
    },
    {
        href: '/sockets',
        title: 'Sockets',
        body: 'One broadcast topic per file under src/server/sockets/. publish() is isomorphic, retention is opt-in via tail: n, and every browser subscription multiplexes one WebSocket.',
    },
    {
        href: '/cache',
        title: 'cache',
        body: 'Isomorphic memoise + coalesce — identical in-flight calls share one flight, ttl is only the retention dial, and cache.invalidate re-runs every $derived that read a dropped entry.',
    },
    {
        href: '/probes',
        title: 'pending / refreshing',
        body: 'Standalone reactive probes spanning calls and streams. pending = no value yet; refreshing = value held, fresher source in flight. They report, never act.',
    },
    {
        href: '/pages',
        title: 'Pages',
        body: 'Folders under src/browser/pages/ are routes — [id] params, nearest-only layout.svelte, error.svelte failure boundaries — plus the reactive page state and navigate().',
    },
    {
        href: '/url',
        title: 'url',
        body: 'One typed, base-correct builder for every in-app URL — page links, asset refs, and rpc hrefs. Reads the path to pick the resolution; carries the APP_URL subpath base so rooted links stay inside the mount.',
    },
    {
        href: '/tail',
        title: 'tail',
        body: 'The reactive consumer for anything streaming — a socket or fn.stream(args). First $derived read opens the stream, last reader closes it; transport drops self-heal.',
    },
    {
        href: '/agent',
        title: 'agent',
        body: "agent(engine, messages) runs a model against the app's own gated MCP surface and streams AgentFrames; the handler picks the transport.",
    },
    {
        href: '/mcp',
        title: 'MCP',
        body: 'POST /__belte/mcp, JSON-RPC — tools from clients.mcp verbs and schema’d sockets, prompts from src/mcp/prompts/*.md, resources from src/mcp/resources/.',
    },
    {
        href: '/cli',
        title: 'CLI',
        body: 'A standalone binary: subcommands with schema-derived flags, streamed jsonl/sse, and a REPL — installable via curl <app>/__belte/cli | sh.',
    },
    {
        href: '/bundle',
        title: 'bundle',
        body: 'belte bundle wraps the app in a movable desktop app — native menus through onMenu(), a connect screen for embedded or remote servers, bundled() to detect the context.',
    },
] as const
</script>

<h1 class="text-3xl font-bold">belte kitchen-sink</h1>
<p class="mt-2 text-slate-600">
    Working demos of every primitive in the framework, organised by README section — one typed
    backend reaching the browser, MCP, the CLI, and a native desktop bundle.
</p>

<section class="mt-8 grid gap-4 sm:grid-cols-2">
    {#each cards as card (card.href)}
        <a
            href={card.href}
            class="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
            <h2 class="text-lg font-semibold"><code class="font-mono">{card.title}</code></h2>
            <p class="mt-1 text-sm text-slate-600">{card.body}</p>
        </a>
    {/each}
</section>

<section class="mt-10 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-lg font-semibold">Composed showcase: cookie-session auth</h2>
    <p class="mt-1 text-sm text-slate-600">
        <a class="underline" href="/auth/dashboard">/auth/dashboard</a>
        is gated by a nested layout. The
        <code class="font-mono">auth/layout.svelte</code>
        <em>replaces</em>
        the root layout for everything under <code class="font-mono">/auth</code>
        (layouts are nearest-only), and the session rides a cookie written through
        <code class="font-mono">cookies()</code>
        — see <a class="underline" href="/rpc/request-scope">Request scope</a>.
    </p>
</section>
