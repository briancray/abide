// THE SITE: one page per primitive, grouped by what it is for — its route, its words, and the
// REGISTRY section whose rows it carries (40.42). One home for what a page is CALLED and what it
// COVERS, so the nav, the home page's index, the page's own header and the coverage gates read one
// list. What a page SAYS is its `index.abide`.
//
// `registry` is a REGISTRY heading: a `##` section, or a `#` group where the rows sit under it
// directly. Every row of REGISTRY is on exactly the page whose `registry` is its section (40.43).

export type SitePage = {
    route: string
    /** What a reader looks it up by: its names, or the construct it is. */
    title: string
    nav: string
    /** One sentence: what you use it for. The home page's index lists it under the page. */
    description: string
    /** The REGISTRY `##` heading (or `#` group) whose rows this page carries. */
    registry: string
}

export type SiteGroup = {
    group: string
    /** One sentence: what the pages in it have in common. */
    description: string
    pages: readonly SitePage[]
}

export const SITE: readonly SiteGroup[] = [
    {
        group: 'Reactive primitives',
        description:
            'One value that loads, reloads, streams and fails, and the effects and selections over it.',
        pages: [
            {
                route: '/reactive/reactive',
                title: '`reactive`',
                nav: '`reactive`',
                description:
                    'Hold a value, derive one from others, or load one from the server — reads, writes, probes and triggers on one type.',
                registry: '`reactive` — the one value',
            },
            {
                route: '/reactive/watch',
                title: '`watch`',
                nav: '`watch`',
                description:
                    'Run a side effect each time the values it reads change, and stop it with the disposer it returns.',
                registry: '`watch` — the effect',
            },
            {
                route: '/reactive/selections',
                title: 'Selections',
                nav: 'Selections',
                description:
                    'Reach many entries of a keyed value at once — refresh, invalidate or patch every entry a predicate picks.',
                registry: 'Selections — over many entries',
            },
            {
                route: '/reactive/refusals',
                title: '`refuse` and `Failed`',
                nav: 'Refusals',
                description:
                    'Fail with a name and typed data the caller can branch on, instead of a thrown string.',
                registry: 'Refusals',
            },
            {
                route: '/reactive/tracking',
                title: 'Tracking',
                nav: 'Tracking',
                description:
                    'Which reads subscribe, which do not, and how to read a value without following it.',
                registry: 'Tracking',
            },
        ],
    },
    {
        group: 'Transports',
        description:
            'A handler file is a server function a page calls by name, with its type the same on both sides.',
        pages: [
            {
                route: '/transports/rpc',
                title: '`GET` / `POST` and `Rpc`',
                nav: 'Handlers',
                description:
                    'Write a handler once and call it from a page as a reactive value — options, streaming answers and response helpers.',
                registry: '`rpc` — `reactive` + transport',
            },
            {
                route: '/transports/mount-paths',
                title: 'Mount paths',
                nav: 'Mount paths',
                description:
                    'Where a handler file is served: its address follows its path under `src`.',
                registry: 'Mount paths',
            },
            {
                route: '/transports/schemas',
                title: 'Schemas',
                nav: 'Schemas',
                description:
                    "Validate a handler's arguments with any Standard Schema, or with the JSON Schema abide reads off its type.",
                registry: 'Schemas',
            },
            {
                route: '/transports/headers',
                title: 'Headers abide generates',
                nav: 'Headers',
                description:
                    'The headers every answer carries without you writing them, and what each one is for.',
                registry: 'Headers abide generates',
            },
        ],
    },
    {
        group: 'Generated surfaces',
        description:
            'The handler a page calls is also an OpenAPI operation, an MCP tool and a CLI command.',
        pages: [
            {
                route: '/surfaces/clients',
                title: '`clients`',
                nav: 'Clients',
                description:
                    'Choose which surfaces a handler is on: the page, OpenAPI, MCP and the command line.',
                registry: 'Generated surfaces',
            },
            {
                route: '/surfaces/openapi',
                title: 'OpenAPI',
                nav: 'OpenAPI',
                description:
                    'The OpenAPI document abide writes from your handlers, and where it is served.',
                registry: 'OpenAPI',
            },
            {
                route: '/surfaces/mcp',
                title: 'MCP',
                nav: 'MCP',
                description:
                    'Your handlers as the tools of an MCP server a model connects to.',
                registry: 'MCP',
            },
        ],
    },
    {
        group: 'Assistant',
        description:
            'A conversation with a model that calls your handlers as tools, as the same person who asked.',
        pages: [
            {
                route: '/ai/assistant',
                title: '`assistant`',
                nav: '`assistant`',
                description:
                    'Stream a conversation with a model whose tools are your handlers, and read what each call answered.',
                registry: 'Assistant',
            },
            {
                route: '/ai/provider',
                title: '`provider`',
                nav: '`provider`',
                description:
                    "Run the conversation on the Claude API, or on the visitor's own Claude Code through the bridge.",
                registry: '`provider`',
            },
            {
                route: '/ai/pairing',
                title: '`pairing`',
                nav: '`pairing`',
                description:
                    "Pair this browser with the visitor's Claude Code: the click, the command and the status.",
                registry: '`pairing`',
            },
        ],
    },
    {
        group: 'Ambient values',
        description:
            'What is true where the code runs — the request, the route, the network, the person — read without passing it in.',
        pages: [
            {
                route: '/ambient/cookies',
                title: '`cookies`',
                nav: '`cookies`',
                description:
                    "Read and set the request's cookies from any server code it reaches.",
                registry: '`cookies`',
            },
            {
                route: '/ambient/request',
                title: '`request`',
                nav: '`request`',
                description:
                    'The request being answered, from anywhere in the code answering it.',
                registry: '`request`',
            },
            {
                route: '/ambient/response',
                title: '`response`',
                nav: '`response`',
                description:
                    "Set the status and headers of the answer being written, from inside a handler's body.",
                registry: '`response`',
            },
            {
                route: '/ambient/route',
                title: '`route`',
                nav: '`route`',
                description:
                    "The page's address, its params and its query, as reactive values.",
                registry: '`route`',
            },
            {
                route: '/ambient/online',
                title: '`online`',
                nav: '`online`',
                description:
                    'Whether the browser has a network, as a value a page reads.',
                registry: '`online`',
            },
            {
                route: '/ambient/media',
                title: '`media`',
                nav: '`media`',
                description:
                    'Follow a CSS media query — a width, a color scheme — from script.',
                registry: '`media`',
            },
            {
                route: '/ambient/outbox',
                title: '`outbox`',
                nav: '`outbox`',
                description:
                    'Writes made offline, queued and sent in order when the server is back.',
                registry: '`outbox`',
            },
            {
                route: '/ambient/reachable',
                title: '`reachable`',
                nav: '`reachable`',
                description:
                    'Whether the app’s own server answers, which is not the same as being online.',
                registry: '`reachable`',
            },
            {
                route: '/ambient/trace',
                title: '`trace`',
                nav: '`trace`',
                description:
                    'One id that follows a request through every handler and log line it reaches.',
                registry: '`trace`',
            },
            {
                route: '/ambient/server',
                title: '`server`',
                nav: '`server`',
                description: 'The Bun server answering the request.',
                registry: '`server`',
            },
            {
                route: '/ambient/is-server',
                title: '`isServer`',
                nav: '`isServer`',
                description:
                    'Whether the code is running on the server or in the browser.',
                registry: '`isServer`',
            },
            {
                route: '/ambient/health',
                title: '`health`',
                nav: '`health`',
                description:
                    'What a load balancer and an operator read to decide the server is well.',
                registry: '`health`',
            },
            {
                route: '/ambient/principal',
                title: '`principal`',
                nav: '`principal`',
                description:
                    'Who is asking: sign them in, read who they are, and decide what they see.',
                registry: '`principal`',
            },
            {
                route: '/ambient/config',
                title: '`config`',
                nav: '`config`',
                description:
                    'Typed configuration read from the environment and validated once, at start.',
                registry: '`config`',
            },
        ],
    },
    {
        group: 'Helpers',
        description:
            'Logging, the database, the content security policy, addresses, navigation and observing elements.',
        pages: [
            {
                route: '/helpers/log',
                title: '`log`',
                nav: '`log`',
                description:
                    'Named, leveled logging that reads `DEBUG` on both sides.',
                registry: '`log`',
            },
            {
                route: '/helpers/database',
                title: '`database`',
                nav: '`database`',
                description:
                    "The app's SQLite database, opened where the deployment keeps its data.",
                registry: '`database`',
            },
            {
                route: '/helpers/csp',
                title: '`csp`',
                nav: '`csp`',
                description:
                    'A content security policy as middleware, with the nonce abide writes into its own scripts.',
                registry: '`csp`',
            },
            {
                route: '/helpers/url',
                title: '`url`',
                nav: '`url`',
                description:
                    'A typed address for a page or a handler, right under any mount path.',
                registry: '`url`',
            },
            {
                route: '/helpers/navigate',
                title: '`navigate`',
                nav: '`navigate`',
                description: 'Go to another page from script.',
                registry: '`navigate`',
            },
            {
                route: '/helpers/observe',
                title: '`observe`',
                nav: '`observe`',
                description:
                    "An element's size, visibility and position, as values a template binds to.",
                registry: '`observe`',
            },
        ],
    },
    {
        group: '`.abide` files',
        description:
            'A component is a `.abide` file: script blocks, markup, and the reactive values it reads by name.',
        pages: [
            {
                route: '/abide-files/by-name',
                title: 'Reading and writing by name',
                nav: 'Reading by name',
                description:
                    'Read a reactive value by its name and assign to it, with the explicit calls still compiling.',
                registry: 'Reading and writing by name',
            },
            {
                route: '/abide-files/templating',
                title: 'Templating',
                nav: 'Templating',
                description:
                    'Expressions, attributes, bindings, `{#if}`, `{#for}`, `{#try}` and components in markup.',
                registry: 'Templating',
            },
            {
                route: '/abide-files/props',
                title: '`props`',
                nav: '`props`',
                description:
                    'What a component takes from the markup that uses it, typed where it declares them.',
                registry: 'Props',
            },
            {
                route: '/abide-files/blocks',
                title: 'Script and style blocks',
                nav: 'Script and style',
                description:
                    'Which code runs where: `<script>`, `<script server>`, `<script module>` and scoped `<style>`.',
                registry: 'Script / style blocks',
            },
        ],
    },
    {
        group: 'Pages and routing',
        description:
            'A file under `src` is a page at the address its path spells, inside the layouts above it.',
        pages: [
            {
                route: '/pages/pages',
                title: 'Pages and layouts',
                nav: 'Pages',
                description:
                    'Routes from files, params from brackets, layouts that wrap them, and the `<head>` a page writes.',
                registry: 'Pages',
            },
            {
                route: '/pages/render',
                title: '`render`',
                nav: '`render`',
                description:
                    'Render a component to HTML on the server — for an email, a preview, a document.',
                registry: '`render`',
            },
            {
                route: '/pages/sinks',
                title: 'Sinks',
                nav: 'Sinks',
                description:
                    'Where a value becomes markup or an address, and what abide escapes on the way.',
                registry: 'Sinks',
            },
        ],
    },
    {
        group: 'Configuration',
        description:
            'What the app reads from its environment and its files, and the hooks it runs on the server.',
        pages: [
            {
                route: '/configuration/environment',
                title: 'Environment variables',
                nav: 'Environment',
                description:
                    'Every variable abide reads, and what each one changes.',
                registry: 'Environment variables',
            },
            {
                route: '/configuration/files',
                title: 'Files',
                nav: 'Files',
                description:
                    'What each file and directory under `src` means to abide.',
                registry: 'Files',
            },
            {
                route: '/configuration/hooks',
                title: 'Lifecycle hooks',
                nav: 'Hooks',
                description:
                    'Middleware, and code run as the server starts, stops, fails or signs someone in.',
                registry: 'Lifecycle hooks',
            },
            {
                route: '/configuration/native',
                title: 'The native app',
                nav: 'Native app',
                description:
                    'The window, the menu bar and the updates of the app `abide bundle` writes.',
                registry: 'The native app',
            },
        ],
    },
    {
        group: 'The app object',
        description:
            'The app as a value: build one, serve it, and stop it — in a test, or inside another server.',
        pages: [
            {
                route: '/app/create-app',
                title: '`createApp`',
                nav: '`createApp`',
                description:
                    'Start the app in-process and drive it through `fetch`, for tests and for embedding.',
                registry: 'The app object',
            },
        ],
    },
    {
        group: 'Tests',
        description: 'Render a component in `bun test` and read what it did.',
        pages: [
            {
                route: '/testing/mount',
                title: '`mount`',
                nav: '`mount`',
                description:
                    'Mount a component into the test DOM and assert on what it rendered.',
                registry: 'Tests',
            },
        ],
    },
    {
        group: 'The measurement harness',
        description:
            '`@abide/harness`: count the work an op does, time it against a hand-written arm, and gate the result.',
        pages: [
            {
                route: '/harness/measure',
                title: '`@abide/harness/measure`',
                nav: 'measure',
                description:
                    'Count the DOM calls an op makes, from inside the page, in both engines.',
                registry:
                    '`@abide/harness/measure` — DOM calls, counted from inside the page',
            },
            {
                route: '/harness/preload',
                title: '`@abide/harness/preload`',
                nav: 'preload',
                description: 'A DOM for `bun test`, registered by one line.',
                registry: '`@abide/harness/preload` — a DOM for `bun test`',
            },
            {
                route: '/harness/engine',
                title: '`@abide/harness/engine`',
                nav: 'engine',
                description:
                    'What the browser engine did for an op: style, layout and paint, and the share each took.',
                registry:
                    '`@abide/harness/engine` — what the browser engine did',
            },
            {
                route: '/harness/server',
                title: '`@abide/harness/server`',
                nav: 'server',
                description:
                    'Bytes on the wire, microtask turns and allocations, measured on Bun.',
                registry:
                    '`@abide/harness/server` — bytes, turns and allocations',
            },
            {
                route: '/harness/report',
                title: '`@abide/harness/report`',
                nav: 'report',
                description:
                    'Samples, the batcher and `ratio()`: a timing claim against a hand-written arm.',
                registry:
                    '`@abide/harness/report` — samples, ratios and the clock',
            },
            {
                route: '/harness/gate',
                title: '`@abide/harness/gate`',
                nav: 'gate',
                description:
                    'A test whose broken arm can be installed and watched to fail.',
                registry:
                    '`@abide/harness/gate` — tests whose revert can be run',
            },
            {
                route: '/harness/rows',
                title: '`@abide/harness/rows`',
                nav: 'rows',
                description: 'The row format a reader of runner output keeps.',
                registry: '`@abide/harness/rows` — what a runner prints',
            },
            {
                route: '/harness/runner',
                title: '`@abide/harness/runner`',
                nav: 'runner',
                description:
                    'Run tests and benches and print what they reported as rows.',
                registry:
                    '`@abide/harness/runner` — runners that print rows, and the bench runner',
            },
            {
                route: '/harness/abide',
                title: '`@abide/harness/abide`',
                nav: 'abide',
                description:
                    'Measure an abide app: wakes, binding runs and descents beside the DOM calls.',
                registry:
                    '`@abide/harness/abide` — the adapter for an abide app',
            },
        ],
    },
    {
        group: 'CLI',
        description:
            'The `abide` command and the bridge that connects Claude Code to a site.',
        pages: [
            {
                route: '/cli/commands',
                title: '`abide` commands',
                nav: 'Commands',
                description:
                    'Scaffold, develop, check, build, start, compile and bundle an app.',
                registry: 'Commands',
            },
            {
                route: '/cli/bridge',
                title: '`abide-bridge`',
                nav: 'Bridge',
                description:
                    "Connect your Claude Code to an abide site's assistant.",
                registry: '`abide-bridge` — the bridge',
            },
        ],
    },
]
