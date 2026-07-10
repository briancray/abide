/*
The curated cookbook structure — the single source of truth for section titles,
blurbs, ordering, and the human sub-page labels. Ordered by how often the job
comes up building a web app (templating and reactive state first, the
beyond-the-browser surfaces last).

This is CONFIG, not the full index: it names each sub-page but not the individual
recipes on it. scripts/cookbookIndex.ts reads this, globs each sub-page's
`page.abide` for its Recipe tasks, and emits cookbookIndex.generated.ts — the
enriched tree the cookbook page renders and searches. Add a section or reorder
here; re-run `bun run cookbook:index` to fold in the recipes.
*/
export type CookbookPageRef = {
    href: string
    label: string
}

export type CookbookSectionConfig = {
    title: string
    blurb: string
    pages: CookbookPageRef[]
}

export const cookbookSections: CookbookSectionConfig[] = [
    {
        title: 'templating',
        blurb: 'Render the DOM — control flow, bindings, interpolation, components, snippets, raw markup, scoped style.',
        pages: [
            { href: '/cookbook/templating/control-flow', label: 'control flow' },
            { href: '/cookbook/templating/bindings', label: 'bindings & interpolation' },
            { href: '/cookbook/templating/components', label: 'components & snippets' },
            { href: '/cookbook/templating/markup', label: 'raw html & scoped style' },
        ],
    },
    {
        title: 'reactive state',
        blurb: 'Local reactivity — imported state / state.computed / state.linked, watch, transforms, two-way bindings.',
        pages: [
            { href: '/cookbook/state/scope', label: 'state basics' },
            { href: '/cookbook/state/derived', label: 'computed, linked, transforms' },
            { href: '/cookbook/state/effects', label: 'watch' },
            { href: '/cookbook/state/bindings', label: 'shared context' },
        ],
    },
    {
        title: 'data & SSR',
        blurb: 'Get data to the page — await on the server, stream to the client, smart calls, coalesce, refresh, hydrate warm.',
        pages: [
            { href: '/cookbook/data/await-ssr', label: 'await during SSR' },
            { href: '/cookbook/data/stream', label: 'stream to the UI' },
            { href: '/cookbook/data/cache', label: 'smart calls & refresh' },
            { href: '/cookbook/data/hydrate', label: 'hydrate & fetch patterns' },
        ],
    },
    {
        title: 'routing & navigation',
        blurb: 'Move between pages — folder routes, [id] params, layout chains, navigate(), typed url(), redirects.',
        pages: [
            { href: '/cookbook/routing/routes', label: 'routes & params' },
            { href: '/cookbook/routing/layouts', label: 'layout chains' },
            { href: '/cookbook/routing/navigate', label: 'navigate, url & redirects' },
        ],
    },
    {
        title: 'forms & mutations',
        blurb: 'Send data back — POST / PUT / PATCH / DELETE rpcs, schema validation, optimistic updates, refresh-after-write.',
        pages: [
            { href: '/cookbook/forms/rpc-methods', label: 'rpc methods' },
            { href: '/cookbook/forms/validation', label: 'validation' },
            { href: '/cookbook/forms/optimistic', label: 'optimistic & flows' },
        ],
    },
    {
        title: 'errors & resilience',
        blurb: 'Fail gracefully — typed HttpError, try/catch boundaries, pending / refreshing probes.',
        pages: [
            { href: '/cookbook/errors/throwing', label: 'throwing & catching' },
            { href: '/cookbook/errors/boundaries', label: 'failure boundaries' },
            { href: '/cookbook/errors/probes', label: 'pending & refreshing' },
        ],
    },
    {
        title: 'realtime',
        blurb: 'Push live — broadcast sockets, publish(), retention, presence, self-healing reconnects.',
        pages: [
            { href: '/cookbook/realtime/sockets', label: 'sockets & broadcast' },
            { href: '/cookbook/realtime/patterns', label: 'presence & patterns' },
        ],
    },
    {
        title: 'beyond the browser',
        blurb: 'Reach past the tab — run a model over the MCP surface, expose MCP tools, ship a CLI and a desktop bundle.',
        pages: [
            { href: '/cookbook/beyond/agent', label: 'agent' },
            { href: '/cookbook/beyond/mcp', label: 'mcp' },
            { href: '/cookbook/beyond/cli', label: 'cli' },
            { href: '/cookbook/beyond/bundle', label: 'desktop bundle' },
        ],
    },
    {
        title: 'auth & security',
        blurb: 'Lock it down — the cross-origin gate, crossOrigin opt-out, auth middleware, whoAmI, gated MCP.',
        pages: [
            { href: '/cookbook/security/origin', label: 'origin gate' },
            { href: '/cookbook/security/auth', label: 'auth & identity' },
            { href: '/cookbook/security/mcp-auth', label: 'gating MCP' },
        ],
    },
    {
        title: 'build, test & deploy',
        blurb: 'Ship it — env() config, boot hooks, createTestApp, the compiled binary + Dockerfile, observability.',
        pages: [
            { href: '/cookbook/ops/config', label: 'config & boot' },
            { href: '/cookbook/ops/testing', label: 'testing' },
            { href: '/cookbook/ops/deploy', label: 'build & deploy' },
        ],
    },
    {
        title: 'files & media',
        blurb: 'Move bytes — multipart uploads, downloads with content-type, byte ranges, bundled + public assets.',
        pages: [
            { href: '/cookbook/files/uploads', label: 'uploads' },
            { href: '/cookbook/files/downloads', label: 'downloads & ranges' },
            { href: '/cookbook/files/assets', label: 'static assets' },
        ],
    },
    {
        title: 'offline & local-first',
        blurb: 'Survive the network — the durable outbox, retry(), health-driven drain, local persistence.',
        pages: [
            { href: '/cookbook/offline/outbox', label: 'outbox' },
            { href: '/cookbook/offline/resilience', label: 'offline resilience' },
        ],
    },
]
