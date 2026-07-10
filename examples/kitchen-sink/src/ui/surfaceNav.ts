/*
The surface navigation — the one source of truth for the top-level pages, grouped
by the job they do: land on the cookbook, stand up the server, build the UI on it,
reach past the browser, then ship and look it up.

Both surfaces render from this: the sidebar (layout.abide) lists every page and its
`anchors` as flat links; the landing grid (page.abide) shows one card per page with
its `body`. `label` is the sidebar text, `title` the card heading (defaults to
`label`), and `anchors` are in-page jumps that only surface in the sidebar. Add a
page here once and it appears in both — no second copy to keep in sync. (Recipes
live in their own generated index — see cookbookSections.ts / cookbookIndex.)
*/
export type SurfaceAnchor = {
    href: string
    label: string
}

export type SurfacePage = {
    href: string
    label: string
    title?: string
    body: string
    anchors?: SurfaceAnchor[]
}

export type SurfaceGroup = {
    title: string
    pages: SurfacePage[]
}

export const surfaceNav: SurfaceGroup[] = [
    {
        title: 'recipes',
        pages: [
            {
                href: '/cookbook',
                label: 'cookbook',
                body: 'Task-first recipes — search or browse every snippet by the job you came to do, not the primitive; each names the nuance people get wrong and links into the surface page that demos it.',
            },
        ],
    },
    {
        title: 'build the server',
        pages: [
            {
                href: '/rpc',
                label: 'rpc',
                body: 'One rpc per file under src/server/rpc/ — GET / POST / PUT / PATCH / DELETE / HEAD. The schema validates args and projects the MCP tool, CLI flags, and OpenAPI operation from one declaration.',
            },
            {
                href: '/sockets',
                label: 'sockets',
                body: 'One broadcast topic per file under src/server/sockets/. publish() is isomorphic, retention defaults to the last frame (tail: 1) and scales via tail: n, and every browser subscription multiplexes one WebSocket.',
            },
            {
                href: '/security',
                label: 'security',
                body: 'Mutating rpcs 403 a cross-origin browser Origin before the handler runs; crossOrigin: true is the per-rpc opt-out. /__abide/mcp gets the same check, and boot warns when MCP tools ship with no auth middleware.',
            },
        ],
    },
    {
        title: 'build the ui',
        pages: [
            {
                href: '/pages',
                label: 'pages',
                body: 'Folders under src/ui/pages/ are routes — [id] params, nested layout.abide chains, try/catch failure boundaries — plus the reactive page state, navigate(), and the typed base-correct url() builder.',
            },
            {
                href: '/templating',
                label: 'templating',
                body: 'The .abide grammar — every {#…} control-flow block, {expr} / interpolated / bind: / class: / style: / attach / spread bindings, html raw markup, snippets, components & {children()}, and scoped <style>.',
            },
            {
                href: '/reactive-state',
                label: 'reactive state',
                body: 'state / state.computed / state.linked and watch are imported from abide/ui and called bare; transforms coerce writes, watch names a reaction, and refresh / patch drive cached reads.',
            },
            {
                href: '/probes',
                label: 'probes',
                body: 'Standalone reactive probes over smart calls and streams — pending (no value yet), refreshing (value held, fresher source in flight), and peek (the retained value, synchronously). They report, never act.',
            },
            {
                href: '/outbox',
                label: 'outbox',
                body: 'Local-first durability per rpc — a call that parks on an unreachable server, persists, and drains when health() recovers; retry() and pending() span the queue.',
            },
        ],
    },
    {
        title: 'beyond the browser',
        pages: [
            {
                href: '/agent',
                label: 'agent',
                body: "agent(engine, messages) runs a model against the app's own gated MCP surface and streams AgentFrames; the handler picks the transport.",
            },
            {
                href: '/mcp',
                label: 'mcp',
                body: 'POST /__abide/mcp, JSON-RPC — tools from clients.mcp rpcs and schema-d sockets, prompts from src/mcp/prompts/*.md, resources from src/mcp/resources/.',
            },
            {
                href: '/cli',
                label: 'cli',
                body: 'A standalone binary: subcommands with schema-computed flags, streamed jsonl/sse, and a REPL — installable via curl <app>/__abide/cli | sh.',
            },
            {
                href: '/bundle',
                label: 'bundle',
                body: 'abide bundle wraps the app in a movable desktop app — native menus through onMenu(), a connect screen for embedded or remote servers, bundled() to detect the context.',
            },
        ],
    },
    {
        title: 'deploy',
        pages: [
            {
                href: '/build',
                label: 'build',
                title: 'build · test · deploy',
                body: 'The dev-to-prod seams — the abide commands, env() config validation and app.ts boot hooks, in-process testing with createTestApp(), and the compiled-binary Dockerfile.',
                anchors: [
                    { href: '/build#testing', label: 'test' },
                    { href: '/build#deploy', label: 'deploy' },
                ],
            },
            {
                href: '/observability',
                label: 'online',
                title: 'observability',
                body: "Connectivity + logging on both sides — online() / health() reachability reads, the one logger with DEBUG-gated channels and timed log.trace spans, and trace() returning the request's W3C traceparent.",
                anchors: [
                    { href: '/observability#health', label: 'health' },
                    { href: '/observability#logging', label: 'logging' },
                ],
            },
        ],
    },
    {
        title: 'reference',
        pages: [
            {
                href: '/reference',
                label: 'types',
                title: 'reference',
                body: 'The cross-cutting reference — project layout, framework routes, every environment variable, and the import namespaces that mark which side a name runs on.',
                anchors: [
                    { href: '/reference#routes', label: 'routes' },
                    { href: '/reference#env', label: 'env' },
                ],
            },
        ],
    },
]
