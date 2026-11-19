// THE SITE: one page per REGISTRY `##` section — one export an app imports, or one construct it
// writes (40.2, 40.3) — grouped as REGISTRY groups them: its route, its words, and the section it
// documents (40.4). One home for what a page is CALLED and what it COVERS, so the nav, the home page's
// index, the page's own header and the coverage gates read one list. What a page SAYS is its
// `index.abide`: its examples, its See also and its Tests.

export type SitePage = {
    route: string
    /** The name it documents, or the construct it is. */
    title: string
    nav: string
    /** One sentence: what you use it for. The home page's index lists it under the page. */
    description: string
    /** The REGISTRY `##` heading whose rows this page carries. */
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
                    'Hold a value, derive one from others, or load or stream one from a handler, with reads, writes, probes and triggers on one type.',
                registry: '`reactive`',
            },
            {
                route: '/reactive/watch',
                title: '`watch`',
                nav: '`watch`',
                description:
                    'Run a side effect each time the values it reads change, and stop it with the disposer it returns.',
                registry: '`watch`',
            },
            {
                route: '/reactive/store',
                title: '`store`',
                nav: '`store`',
                description:
                    'Keep a reactive value somewhere that outlives the process: Web Storage, a cookie, IndexedDB, SQLite, Redis, or your own.',
                registry: '`store`',
            },
            {
                route: '/reactive/refuse',
                title: '`refuse`',
                nav: '`refuse`',
                description:
                    'Declare a named refusal with typed data, return it from a handler, and match it by name where the call is made.',
                registry: '`refuse`',
            },
            {
                route: '/reactive/is-failed',
                title: '`isFailed`',
                nav: '`isFailed`',
                description:
                    'Tell a refusal from any other value or thrown error, including one read back from JSON.',
                registry: '`isFailed`',
            },
            {
                route: '/reactive/busy',
                title: '`busy`',
                nav: '`busy`',
                description:
                    'Ask whether any value, keyed entry, handler call or tagged value in a selection has work in flight.',
                registry: '`busy`',
            },
            {
                route: '/reactive/ready',
                title: '`ready`',
                nav: '`ready`',
                description:
                    'Ask whether every entry in a selection has a value to serve, to show a view only once it is whole.',
                registry: '`ready`',
            },
            {
                route: '/reactive/synced',
                title: '`synced`',
                nav: '`synced`',
                description:
                    'Ask whether every entry in a selection still holds what its producer made, rather than a write made here.',
                registry: '`synced`',
            },
            {
                route: '/reactive/refresh',
                title: '`refresh`',
                nav: '`refresh`',
                description:
                    'Reload a value, a keyed entry, a handler or everything carrying a tag, keeping what is held on screen meanwhile.',
                registry: '`refresh`',
            },
            {
                route: '/reactive/invalidate',
                title: '`invalidate`',
                nav: '`invalidate`',
                description:
                    'Mark a selection stale so its next read loads again, without starting a load now.',
                registry: '`invalidate`',
            },
            {
                route: '/reactive/flush-sync',
                title: '`flushSync`',
                nav: '`flushSync`',
                description:
                    'Run every effect a write woke right now, so a test or a layout read sees the updated page.',
                registry: '`flushSync`',
            },
            {
                route: '/reactive/stop-signal',
                title: '`stopSignal`',
                nav: '`stopSignal`',
                description:
                    "Read the signal a stopping app aborts, so a long job's run or its fetch ends early.",
                registry: '`stopSignal`',
            },
            {
                route: '/reactive/structural',
                title: '`structural`',
                nav: '`structural`',
                description:
                    'Compare values by contents rather than reference, so an equal reload or write wakes nobody.',
                registry: '`structural`',
            },
            {
                route: '/reactive/is-reactive',
                title: '`isReactive`',
                nav: '`isReactive`',
                description:
                    'Check whether a value is a `Reactive`, ahead of any thenable check, since a `Reactive` is thenable.',
                registry: '`isReactive`',
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
                route: '/transports/get',
                title: '`GET`',
                nav: '`GET`',
                description:
                    'Declare a read in a handler file and call it from a page as a reactive value, a stream or a link.',
                registry: '`GET`',
            },
            {
                route: '/transports/post',
                title: '`POST`, `PUT`, `PATCH` and `DELETE`',
                nav: '`POST` and friends',
                description:
                    'Declare a write with `POST`, `PUT`, `PATCH` or `DELETE`, and refresh what it changed once it answers.',
                registry: '`POST`, `PUT`, `PATCH` and `DELETE`',
            },
            {
                route: '/transports/mount-paths',
                title: 'Mount paths',
                nav: 'Mount paths',
                description:
                    "Find the address a handler answers at from its file's path, its `[param]` segments and its `<script server>`.",
                registry: 'Mount paths',
            },
            {
                route: '/transports/validate-json',
                title: '`validateJson`',
                nav: '`validateJson`',
                description:
                    'Check a value against a JSON Schema document, and read what was wrong keyed by the path to it.',
                registry: '`validateJson`',
            },
            {
                route: '/transports/json-schema',
                title: '`jsonSchema`',
                nav: '`jsonSchema`',
                description:
                    "Turn a JSON Schema document into a `Schema` that gates a handler's args and is published as written.",
                registry: '`jsonSchema`',
            },
            {
                route: '/transports/headers',
                title: 'Headers abide generates',
                nav: 'Headers',
                description:
                    'See the headers every answer carries without you writing them, and replace a default from a handler.',
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
                nav: '`clients`',
                description:
                    'Choose which surfaces a handler is on: the page, OpenAPI, MCP and the command line.',
                registry: '`clients`',
            },
            {
                route: '/surfaces/openapi',
                title: 'OpenAPI',
                nav: 'OpenAPI',
                description:
                    'Read the OpenAPI 3.1 document abide writes from your handlers, served or printed beside the code.',
                registry: 'OpenAPI',
            },
            {
                route: '/surfaces/mcp',
                title: 'MCP',
                nav: 'MCP',
                description:
                    'Offer your handlers as the tools of an MCP server a model calls as the person asking.',
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
                    'Stream a conversation with a model whose tools are your handlers, from a handler you write.',
                registry: '`assistant`',
            },
            {
                route: '/ai/results-of',
                title: '`resultsOf`',
                nav: '`resultsOf`',
                description:
                    "Read what a conversation's calls to one handler answered, typed as that handler's value.",
                registry: '`resultsOf`',
            },
            {
                route: '/ai/image-piece',
                title: '`imagePiece`',
                nav: '`imagePiece`',
                description:
                    'Turn an image into a piece of a turn, drawn down to what a model looks at.',
                registry: '`imagePiece`',
            },
            {
                route: '/ai/image-files',
                title: '`imageFiles`',
                nav: '`imageFiles`',
                description:
                    'Take the images a model is shown from a paste or a drop.',
                registry: '`imageFiles`',
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
                    "Pair this browser with the visitor's Claude Code with a click, and follow the pairing's status.",
                registry: '`pairing`',
            },
            {
                route: '/ai/transcript',
                title: '`transcript`',
                nav: '`transcript`',
                description:
                    'Fold a streamed answer into the turns a chat shows, and send them back as messages.',
                registry: '`transcript`',
            },
        ],
    },
    {
        group: 'Ambient values',
        description:
            'What is true where the code runs — the request, the route, the network, the person — read without passing it in.',
        pages: [
            {
                route: '/ambient/request',
                title: '`request`',
                nav: '`request`',
                description:
                    "Read the request being answered, its headers, signal and caller's address, from anywhere in the code answering it.",
                registry: '`request`',
            },
            {
                route: '/ambient/response',
                title: '`response`',
                nav: '`response`',
                description:
                    'Set the status and headers of the answer, or fix it as a page, JSON, a redirect, or a stream.',
                registry: '`response`',
            },
            {
                route: '/ambient/cookies',
                title: '`cookies`',
                nav: '`cookies`',
                description:
                    'Read and write cookies by name on both sides, so the server paints what the browser chose.',
                registry: '`cookies`',
            },
            {
                route: '/ambient/route',
                title: '`route`',
                nav: '`route`',
                description:
                    "Read the page's address, its params and its query as reactive values, and keep page state in the address.",
                registry: '`route`',
            },
            {
                route: '/ambient/online',
                title: '`online`',
                nav: '`online`',
                description:
                    'Tell the reader the browser has lost its network, and catch up when it returns.',
                registry: '`online`',
            },
            {
                route: '/ambient/media',
                title: '`media`',
                nav: '`media`',
                description:
                    'Follow a CSS media query, such as a width or reduced motion, from script as a value a page reads.',
                registry: '`media`',
            },
            {
                route: '/ambient/outbox',
                title: '`outbox`',
                nav: '`outbox`',
                description:
                    'Queue writes made offline, send them in order once the server answers, and retry or drop the refused ones.',
                registry: '`outbox`',
            },
            {
                route: '/ambient/reachable',
                title: '`reachable`',
                nav: '`reachable`',
                description:
                    'Ask whether another host answers, so a handler can refuse at once while it is down.',
                registry: '`reachable`',
            },
            {
                route: '/ambient/trace',
                title: '`trace`',
                nav: '`trace`',
                description:
                    'Follow one request through every handler, log line and outbound call with one trace id, and time its spans.',
                registry: '`trace`',
            },
            {
                route: '/ambient/server',
                title: '`server`',
                nav: '`server`',
                description:
                    'Reach the listening Bun server for what abide does not carry, such as requests in flight.',
                registry: '`server`',
            },
            {
                route: '/ambient/is-server',
                title: '`isServer`',
                nav: '`isServer`',
                description:
                    "Tell whether code is running in a server's request or render or in the browser, to guard browser-only APIs.",
                registry: '`isServer`',
            },
            {
                route: '/ambient/health',
                title: '`health`',
                nav: '`health`',
                description:
                    "Read the app's health report, the same one a load balancer polls, with your own fields beside the baseline.",
                registry: '`health`',
            },
            {
                route: '/ambient/principal',
                title: '`principal`',
                nav: '`principal`',
                description:
                    'Sign a caller in and out, read who they are, and decide in a handler what they see.',
                registry: '`principal`',
            },
            {
                route: '/ambient/config',
                title: '`config`',
                nav: '`config`',
                description:
                    'Read typed settings, defaulted by `onConfig` and overridden by the environment, validated once at start.',
                registry: '`config`',
            },
        ],
    },
    {
        group: 'Helpers',
        description:
            'Logging, problem reports, the database, the content security policy, addresses, navigation and observing elements.',
        pages: [
            {
                route: '/helpers/log',
                title: '`log`',
                nav: '`log`',
                description:
                    'Write leveled lines under a named namespace, turned on with `DEBUG` on the server and in the browser.',
                registry: '`log`',
            },
            {
                route: '/helpers/report',
                title: '`report`',
                nav: '`report`',
                description:
                    "Start a problem report from a failed call's trace, let the person read every word, and send it to `onReport`.",
                registry: '`report`',
            },
            {
                route: '/helpers/database',
                title: '`database`',
                nav: '`database`',
                description:
                    "Open the app's SQLite file where the deployment keeps its data, and run each migration once, in order.",
                registry: '`database`',
            },
            {
                route: '/helpers/csp',
                title: '`csp`',
                nav: '`csp`',
                description:
                    "Admit only the app's own scripts and styles with a content security policy, and read the nonce for an inline script.",
                registry: '`csp`',
            },
            {
                route: '/helpers/url',
                title: '`url`',
                nav: '`url`',
                description:
                    'Build a typed address from the route a page is filed under, with its query, right under any mount path.',
                registry: '`url`',
            },
            {
                route: '/helpers/navigate',
                title: '`navigate`',
                nav: '`navigate`',
                description:
                    'Go to another page from script without reloading, or step back and forward through the history.',
                registry: '`navigate`',
            },
            {
                route: '/helpers/observe',
                title: '`observe`',
                nav: '`observe`',
                description:
                    "Bind an element's size, visibility or position to reactive values a template reads.",
                registry: '`observe`',
            },
            {
                route: '/helpers/format',
                title: '`format`',
                nav: '`format`',
                description:
                    'Write money, percents, counts, lists, dates and durations the same on server and browser, with a dash for missing values.',
                registry: '`format`',
            },
            {
                route: '/helpers/markdown',
                title: '`markdown`',
                nav: '`markdown`',
                description:
                    'Turn markdown into HTML safe to hand `raw`, with its HTML escaped and unsafe links reduced to text.',
                registry: '`markdown`',
            },
            {
                route: '/helpers/hotkeys',
                title: '`hotkeys`',
                nav: '`hotkeys`',
                description:
                    'Map key presses to commands with one `keydown` listener that stands aside while the visitor types.',
                registry: '`hotkeys`',
            },
            {
                route: '/helpers/is-editable-target',
                title: '`isEditableTarget`',
                nav: '`isEditableTarget`',
                description:
                    'Check whether a key event landed in a field the visitor types into, before a listener of your own acts on it.',
                registry: '`isEditableTarget`',
            },
            {
                route: '/helpers/key-label',
                title: '`keyLabel`',
                nav: '`keyLabel`',
                description:
                    "Write a shortcut binding as the visitor's platform shows it, ⌘ on a Mac and Ctrl elsewhere.",
                registry: '`keyLabel`',
            },
            {
                route: '/helpers/dismissible',
                title: '`dismissible`',
                nav: '`dismissible`',
                description:
                    'Close a panel or popover when someone presses outside it or hits Escape.',
                registry: '`dismissible`',
            },
            {
                route: '/helpers/dropzone',
                title: '`dropzone`',
                nav: '`dropzone`',
                description:
                    'Take the files dropped on an element, or pasted into it, filtered by type, and highlight the target while files hover.',
                registry: '`dropzone`',
            },
            {
                route: '/helpers/copy-text',
                title: '`copyText`',
                nav: '`copyText`',
                description:
                    'Copy text to the clipboard when an element is clicked, and mark the element while the copy shows.',
                registry: '`copyText`',
            },
            {
                route: '/helpers/signed-in',
                title: '`signedIn`',
                nav: '`signedIn`',
                description:
                    'Refuse a handler to anyone not signed in, answering `SignedOut` at 401 before the body runs.',
                registry: '`signedIn`',
            },
            {
                route: '/helpers/require-role',
                title: '`requireRole`',
                nav: '`requireRole`',
                description:
                    'Admit only signed-in callers with a role, or ones a test of the principal passes, refusing the rest `Forbidden` at 403.',
                registry: '`requireRole`',
            },
            {
                route: '/helpers/read-only',
                title: '`readOnly`',
                nav: '`readOnly`',
                description:
                    'Refuse every write below a route or to a handler, keeping open the handlers you allow.',
                registry: '`readOnly`',
            },
            {
                route: '/helpers/fetch-json',
                title: '`fetchJson`',
                nav: '`fetchJson`',
                description:
                    'Ask another service for JSON with a deadline, retries and an optional cache, and get a refusal rather than a throw when it gives up.',
                registry: '`fetchJson`',
            },
            {
                route: '/helpers/fetch-text',
                title: '`fetchText`',
                nav: '`fetchText`',
                description:
                    'Ask another service for a text answer with a deadline, retries and an optional cache, and get a refusal when it gives up.',
                registry: '`fetchText`',
            },
            {
                route: '/helpers/job',
                title: '`job`',
                nav: '`job`',
                description:
                    'Run work on the server on a schedule, one run at a time, with a status every page can read.',
                registry: '`job`',
            },
            {
                route: '/helpers/place',
                title: '`place`',
                nav: '`place`',
                description:
                    'Work out where a popover or hint sits beside its anchor, flipped and kept inside the viewport, without writing to the page.',
                registry: '`place`',
            },
            {
                route: '/helpers/listbox',
                title: '`listbox`',
                nav: '`listbox`',
                description:
                    'Put arrow-key, Home, End, Enter and Escape handling on a list of options you render yourself.',
                registry: '`listbox`',
            },
            {
                route: '/helpers/sort-rows',
                title: '`sortRows`',
                nav: '`sortRows`',
                description:
                    'Sort table rows by a column and direction, numbers as numbers, dates by time and blanks last.',
                registry: '`sortRows`',
            },
            {
                route: '/helpers/chart',
                title: '`chart`',
                nav: '`chart`',
                description:
                    'Compute round ticks, linear scales, SVG paths with gaps, and the point nearest the pointer for a chart of your own.',
                registry: '`chart`',
            },
        ],
    },
    {
        group: 'Components',
        description:
            'Dialogs, toasts, menus, lists, tables, charts and a chat, unstyled: you style them by the attributes they write.',
        pages: [
            {
                route: '/components/dialog',
                title: '`Dialog`',
                nav: '`Dialog`',
                description:
                    'Open a native modal dialog from a value you bind, and learn which button closed it.',
                registry: '`Dialog`',
            },
            {
                route: '/components/prompts',
                title: '`Prompts`',
                nav: '`Prompts`',
                description:
                    'Render once in the root layout to show every queued confirm, alert and text prompt, one at a time.',
                registry: '`Prompts`',
            },
            {
                route: '/components/prompts-api',
                title: '`prompts`',
                nav: '`prompts`',
                description:
                    'Ask a yes-or-no question, show a message or ask for a line of text, and await the answer.',
                registry: '`prompts`',
            },
            {
                route: '/components/toasts',
                title: '`Toasts`',
                nav: '`Toasts`',
                description:
                    'Render once in the root layout as the live region where every notice shows and is read out.',
                registry: '`Toasts`',
            },
            {
                route: '/components/toasts-api',
                title: '`toasts`',
                nav: '`toasts`',
                description:
                    'Show a notice that takes itself down, offer one action on it, or dismiss it by its id.',
                registry: '`toasts`',
            },
            {
                route: '/components/tooltip',
                title: '`Tooltip`',
                nav: '`Tooltip`',
                description:
                    'Show a hint for the element just before it, on hover and on focus, placed where it fits.',
                registry: '`Tooltip`',
            },
            {
                route: '/components/menu',
                title: '`Menu`',
                nav: '`Menu`',
                description:
                    'Open a list of actions from a button, walked by the arrow keys and closed by a pick.',
                registry: '`Menu`',
            },
            {
                route: '/components/combobox',
                title: '`Combobox`',
                nav: '`Combobox`',
                description:
                    'Pick one item from a list narrowed or searched on the server as someone types.',
                registry: '`Combobox`',
            },
            {
                route: '/components/tabs',
                title: '`Tabs`',
                nav: '`Tabs`',
                description:
                    'Switch one panel between views from a row of tabs that the arrow keys move along.',
                registry: '`Tabs`',
            },
            {
                route: '/components/sortable-table',
                title: '`SortableTable`',
                nav: '`SortableTable`',
                description:
                    'Show rows in a table whose headers sort them, moving rows rather than rebuilding them.',
                registry: '`SortableTable`',
            },
            {
                route: '/components/markdown',
                title: '`Markdown`',
                nav: '`Markdown`',
                description:
                    'Render markdown as safe markup, a section at a time, so a streamed source redraws only its growing end.',
                registry: '`Markdown`',
            },
            {
                route: '/components/line-chart',
                title: '`LineChart`',
                nav: '`LineChart`',
                description:
                    'Plot one or more series over a shared x, with a crosshair that reads each one out.',
                registry: '`LineChart`',
            },
            {
                route: '/components/sparkline',
                title: '`Sparkline`',
                nav: '`Sparkline`',
                description:
                    'Draw a trend with no axes into any box, marked by its direction for styling.',
                registry: '`Sparkline`',
            },
            {
                route: '/components/chat',
                title: '`Chat`',
                nav: '`Chat`',
                description:
                    'Put a streaming conversation with your assistant handler on a page, with a composer, Stop and tool permissions.',
                registry: '`Chat`',
            },
            {
                route: '/components/pairing',
                title: '`Pairing`',
                nav: '`Pairing`',
                description:
                    "Pair the visitor's Claude Code with the page, and render what you put inside once it is paired.",
                registry: '`Pairing`',
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
                nav: 'Values by name',
                description:
                    'Read a reactive value by naming it and write it by assigning, with the explicit calls still compiling.',
                registry: 'Reading and writing by name',
            },
            {
                route: '/abide-files/expressions',
                title: 'Expressions and attributes',
                nav: 'Expressions',
                description:
                    'Put live values into text, attributes, listeners, classes and styles, and bind form fields both ways.',
                registry: 'Expressions',
            },
            {
                route: '/abide-files/raw',
                title: '`raw`',
                nav: '`raw`',
                description:
                    'Render a string you trust as markup rather than escaped text, such as the HTML `markdown` hands back.',
                registry: '`raw`',
            },
            {
                route: '/abide-files/control-flow',
                title: '`{#if}`, `{#for}` and `{#try}`',
                nav: 'Control flow',
                description:
                    'Show markup on a condition, repeat it over a keyed list, and hold a placeholder or fallback while a region loads or fails.',
                registry: 'Control flow',
            },
            {
                route: '/abide-files/components',
                title: 'Components and slots',
                nav: 'Components and slots',
                description:
                    'Use a component as a tag, pass markup into its slot, and declare small components inline in a file.',
                registry: 'Components and slots',
            },
            {
                route: '/abide-files/props',
                title: '`props`',
                nav: '`props`',
                description:
                    'Take typed, live props from the markup using a component, with defaults, bound writes and element attributes passed through.',
                registry: '`props`',
            },
            {
                route: '/abide-files/blocks',
                title: '`<script>` and `<style>` blocks',
                nav: 'Script and style',
                description:
                    'Split a component into per-instance setup, module scope, server-only code and scoped styles.',
                registry: 'Script and style blocks',
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
                title: 'Pages',
                nav: 'Pages',
                description:
                    'Route pages by file path and dynamic segments, add to the document head, listen on the window, and animate between pages.',
                registry: 'Pages',
            },
            {
                route: '/pages/render',
                title: '`render`',
                nav: '`render`',
                description:
                    "Render a component bound to its props into a document's bytes on the server, for a handler, an email or a file.",
                registry: '`render`',
            },
            {
                route: '/pages/sinks',
                title: 'Sinks',
                nav: 'Sinks',
                description:
                    'Send a page before its data lands, leaving holes in text, attributes, titles and textareas that fill as each value arrives.',
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
                    'Set the port, public URL, secrets, logging, offline mode and telemetry export with environment variables.',
                registry: 'Environment variables',
            },
            {
                route: '/configuration/files',
                title: 'Files abide reads',
                nav: 'Files',
                description:
                    "Lay out the app so each file's path decides its address, its side and its role, and configure the build in `bunfig.toml`.",
                registry: 'Files',
            },
        ],
    },
    {
        group: 'Lifecycle hooks',
        description:
            'Functions an app registers to run around its boot, its requests, its errors and its people.',
        pages: [
            {
                route: '/hooks/middleware',
                title: '`middleware`',
                nav: '`middleware`',
                description:
                    'Run code around every request under a route, to guard a section, gate pages or answer before routing.',
                registry: '`middleware`',
            },
            {
                route: '/hooks/on-start',
                title: '`onStart`',
                nav: '`onStart`',
                description:
                    "Run work around the app's boot, such as connecting a pool or migrating, before the first request is answered.",
                registry: '`onStart`',
            },
            {
                route: '/hooks/on-stop',
                title: '`onStop`',
                nav: '`onStop`',
                description:
                    'Close what the app opened once in-flight requests drain, on a signal, a quit or `App.stop`.',
                registry: '`onStop`',
            },
            {
                route: '/hooks/on-error',
                title: '`onError`',
                nav: '`onError`',
                description:
                    'Send an unexpected error to a tracker, on the server under a route or in the browser under a component.',
                registry: '`onError`',
            },
            {
                route: '/hooks/on-refusal',
                title: '`onRefusal`',
                nav: '`onRefusal`',
                description:
                    "Hear every refusal a browser call gets while a component stands, with the call's method, URL and trace.",
                registry: '`onRefusal`',
            },
            {
                route: '/hooks/on-config',
                title: '`onConfig`',
                nav: '`onConfig`',
                description:
                    'Give config settings defaults a deployment overrides, and check the whole document with a schema before the app starts.',
                registry: '`onConfig`',
            },
            {
                route: '/hooks/on-health',
                title: '`onHealth`',
                nav: '`onHealth`',
                description:
                    "Add the app's own fields, such as a database's state, to the health check at `/__abide/health`.",
                registry: '`onHealth`',
            },
            {
                route: '/hooks/on-principal',
                title: '`onPrincipal`',
                nav: '`onPrincipal`',
                description:
                    'Turn the claims in a signed-in cookie into the member a page and a handler read.',
                registry: '`onPrincipal`',
            },
            {
                route: '/hooks/on-pairing',
                title: '`onPairing`',
                nav: '`onPairing`',
                description:
                    "Set, per person, the Claude Code arguments a pairing's command and install carry after `--`.",
                registry: '`onPairing`',
            },
            {
                route: '/hooks/on-report',
                title: '`onReport`',
                nav: '`onReport`',
                description:
                    'Send each problem report a person files to your tracker, refusing the send when the tracker fails.',
                registry: '`onReport`',
            },
            {
                route: '/hooks/on-launcher',
                title: '`onLauncher`',
                nav: '`onLauncher`',
                description:
                    "Set the native app's window, launcher forms, menu bar extra and update feed.",
                registry: '`onLauncher`',
            },
        ],
    },
    {
        group: 'The native app',
        description:
            'The desktop app an abide app compiles to: its window, its menu bar and its updates.',
        pages: [
            {
                route: '/native-app/native',
                title: '`native`',
                nav: '`native`',
                description:
                    "Tell the native app's window from a browser, and drag the window by a header drawn under its controls.",
                registry: '`native`',
            },
            {
                route: '/native-app/pending-update',
                title: '`pendingUpdate`',
                nav: '`pendingUpdate`',
                description:
                    'Show the update the native window has staged, and restart into it.',
                registry: '`pendingUpdate`',
            },
            {
                route: '/native-app/on-menu',
                title: '`onMenu`',
                nav: '`onMenu`',
                description:
                    "Add menus to the native app's menu bar while a layout or page stands, following the values they read.",
                registry: '`onMenu`',
            },
            {
                route: '/native-app/menu-item',
                title: '`menuItem`',
                nav: '`menuItem`',
                description:
                    'Make a menu bar entry that runs your function when picked, or one the platform performs by role.',
                registry: '`menuItem`',
            },
        ],
    },
    {
        group: 'The app object',
        description:
            'The app as one object a test or a host can start, call and stop.',
        pages: [
            {
                route: '/app/create-app',
                title: '`createApp`',
                nav: '`createApp`',
                description:
                    'Start the app in-process with no port, and drive it through `fetch` and `run` from a test or a host.',
                registry: '`createApp`',
            },
        ],
    },
    {
        group: 'Tests',
        description:
            'Mounting a component in `bun test` and waiting for what it loads.',
        pages: [
            {
                route: '/testing/mount',
                title: '`mount`',
                nav: '`mount`',
                description:
                    'Render and hydrate a component in `bun test`, then click it and read what it rendered.',
                registry: '`mount`',
            },
            {
                route: '/testing/settled',
                title: '`settled`',
                nav: '`settled`',
                description:
                    'Wait in a test until every load and effect a click started has finished, instead of sleeping.',
                registry: '`settled`',
            },
        ],
    },
    {
        group: 'The measurement harness',
        description:
            'Count, time and gate what an app does, with the harness abide is measured with.',
        pages: [
            {
                route: '/harness/measure/measure',
                title: '`measure`',
                nav: '`measure`',
                description:
                    'Count what an op did to the DOM, rows moved, nodes created, text and class writes, and what your own code published while it ran.',
                registry: '`measure` — `@abide/harness/measure`',
            },
            {
                route: '/harness/measure/published-by',
                title: '`publishedBy`',
                nav: '`publishedBy`',
                description:
                    "Read one source's published counters off a `Work`, or `null` when nothing was published.",
                registry: '`publishedBy` — `@abide/harness/measure`',
            },
            {
                route: '/harness/measure/published-work-key',
                title: '`PUBLISHED_WORK_KEY`',
                nav: '`PUBLISHED_WORK_KEY`',
                description:
                    'Publish your own counters under this global so `measure` zeroes them per case and copies them into its result.',
                registry: '`PUBLISHED_WORK_KEY` — `@abide/harness/measure`',
            },
            {
                route: '/harness/measure/time',
                title: '`time`',
                nav: '`time`',
                description:
                    'Time several arms of an op in one interleaved batch, refused while counting and on an emulated DOM.',
                registry: '`time` — `@abide/harness/measure`',
            },
            {
                route: '/harness/measure/patch-set',
                title: '`patchSet`',
                nav: '`patchSet`',
                description:
                    'List every DOM member the measure lane patches, by `Interface.member`, so you know what a count covers.',
                registry: '`patchSet` — `@abide/harness/measure`',
            },
            {
                route: '/harness/preload',
                title: '`@abide/harness/preload`',
                nav: '`preload`',
                description:
                    "Give every `bun test` process a DOM with the measure lane's counters installed, while `fetch` and the wire stay bun's own.",
                registry: '`@abide/harness/preload`',
            },
            {
                route: '/harness/engine/trace-op',
                title: '`traceOp`',
                nav: '`traceOp`',
                description:
                    'Trace one op in a Chromium page from Playwright, and read its style, layout, paint and forced-layout counts and its user timing.',
                registry: '`traceOp` — `@abide/harness/engine`',
            },
            {
                route: '/harness/engine/shares',
                title: '`shares`',
                nav: '`shares`',
                description:
                    'Find what fraction of a whole op one measured layer took, and whether a person would see the saving.',
                registry: '`shares` — `@abide/harness/engine`',
            },
            {
                route: '/harness/engine/measures-named',
                title: '`measuresNamed`',
                nav: '`measuresNamed`',
                description:
                    'List every user-timing measure in a trace with one name, in trace order.',
                registry: '`measuresNamed` — `@abide/harness/engine`',
            },
            {
                route: '/harness/engine/duration-of',
                title: '`durationOf`',
                nav: '`durationOf`',
                description:
                    'Sum the nanoseconds of every measure with one name in a trace.',
                registry: '`durationOf` — `@abide/harness/engine`',
            },
            {
                route: '/harness/server/bytes',
                title: '`bytes`',
                nav: '`bytes`',
                description:
                    "Measure what a response, string or buffer sends, or estimate an object's memory, to compare a render across sizes.",
                registry: '`bytes` — `@abide/harness/server`',
            },
            {
                route: '/harness/server/ticks',
                title: '`ticks`',
                nav: '`ticks`',
                description:
                    "Count the microtask turns a call's result takes to settle.",
                registry: '`ticks` — `@abide/harness/server`',
            },
            {
                route: '/harness/server/retained',
                title: '`retained`',
                nav: '`retained`',
                description:
                    'Diff the live objects a call leaves behind, by engine type, in a process with no DOM.',
                registry: '`retained` — `@abide/harness/server`',
            },
            {
                route: '/harness/server/retained-per-run',
                title: '`retainedPerRun`',
                nav: '`retainedPerRun`',
                description:
                    'Find what each run of a call keeps reachable, as a batch mean, and whether that grows across the batch.',
                registry: '`retainedPerRun` — `@abide/harness/server`',
            },
            {
                route: '/harness/server/closures',
                title: '`closures`',
                nav: '`closures`',
                description:
                    'Count the functions and scopes a call leaves behind, as the pair the engine reports a closure as.',
                registry: '`closures` — `@abide/harness/server`',
            },
            {
                route: '/harness/report/batch',
                title: '`batch`',
                nav: '`batch`',
                description:
                    'Time each arm of an op in interleaved batches sized to the clock, with an A/A floor that says how much difference is noise.',
                registry: '`batch` — `@abide/harness/report`',
            },
            {
                route: '/harness/report/ratio',
                title: '`ratio`',
                nav: '`ratio`',
                description:
                    "Divide one arm's time by another's, getting a number only when the difference clears the floor and a frame.",
                registry: '`ratio` — `@abide/harness/report`',
            },
            {
                route: '/harness/report/claim-of',
                title: '`claimOf`',
                nav: '`claimOf`',
                description:
                    'Print a `ratio` verdict as the one line a bench report shows: a ratio, or why there is none.',
                registry: '`claimOf` — `@abide/harness/report`',
            },
            {
                route: '/harness/report/emulated-dom',
                title: '`emulatedDom`',
                nav: '`emulatedDom`',
                description:
                    'Tell `batch` whether a timed op touched an emulated DOM, so a happy-dom duration is refused rather than quoted.',
                registry: '`emulatedDom` — `@abide/harness/report`',
            },
            {
                route: '/harness/report/thresholds',
                title: '`THRESHOLDS`',
                nav: '`THRESHOLDS`',
                description:
                    'Judge a cost against one frame and the interaction budget, the two lines where a wait becomes visible.',
                registry: '`THRESHOLDS` — `@abide/harness/report`',
            },
            {
                route: '/harness/gate/gate',
                title: '`gate`',
                nav: '`gate`',
                description:
                    'Write a test that carries its own revert, and prove it fails reporting the number the old version did.',
                registry: '`gate` — `@abide/harness/gate`',
            },
            {
                route: '/harness/gate/spawned',
                title: '`spawned`',
                nav: '`spawned`',
                description:
                    'Run a child process from a test, awaited, killed at a deadline that fails the test naming the command.',
                registry: '`spawned` — `@abide/harness/gate`',
            },
            {
                route: '/harness/gate/at-most',
                title: '`atMost`',
                nav: '`atMost`',
                description:
                    'Hold a measured op to a ceiling per counter, failing from your line with every field that went over.',
                registry: '`atMost` — `@abide/harness/gate`',
            },
            {
                route: '/harness/gate/in-a-fresh-process',
                title: '`inAFreshProcess`',
                nav: '`inAFreshProcess`',
                description:
                    'Run source in a child bun with no DOM preloaded and no worker mark, for a check the test process would skew.',
                registry: '`inAFreshProcess` — `@abide/harness/gate`',
            },
            {
                route: '/harness/rows/in-scope',
                title: '`inScope`',
                nav: '`inScope`',
                description:
                    'Select runner rows by `--scope`: all of them, one section, or one item.',
                registry: '`inScope` — `@abide/harness/rows`',
            },
            {
                route: '/harness/rows/matches-filter',
                title: '`matchesFilter`',
                nav: '`matchesFilter`',
                description:
                    'Filter rows by typed text, matched case-insensitively against section and name, the same way the runner selects.',
                registry: '`matchesFilter` — `@abide/harness/rows`',
            },
            {
                route: '/harness/runner/rows-command',
                title: '`rowsCommand`',
                nav: '`rowsCommand`',
                description:
                    'Turn a list of items into a runner command that lists its catalog or streams one JSON row per result.',
                registry: '`rowsCommand` — `@abide/harness/runner`',
            },
            {
                route: '/harness/runner/test-rows',
                title: '`testRows`',
                nav: '`testRows`',
                description:
                    "Run an app's test files one process each, printing a `TestRow` per file as it finishes.",
                registry: '`testRows` — `@abide/harness/runner`',
            },
            {
                route: '/harness/runner/run-benches',
                title: '`runBenches`',
                nav: '`runBenches`',
                description:
                    "Run every `*.bench.ts` under an app's `src`, with each arm's time per operation and every ceiling it broke.",
                registry: '`runBenches` — `@abide/harness/runner`',
            },
            {
                route: '/harness/abide/measure',
                title: '`measure`',
                nav: '`measure` for abide',
                description:
                    "Count the DOM work an op did in a test, with abide's wakes, binding runs and descents beside it.",
                registry: '`measure` — `@abide/harness/abide`',
            },
            {
                route: '/harness/abide/preload',
                title: '`@abide/harness/abide/preload`',
                nav: '`abide/preload`',
                description:
                    'Add one `bunfig.toml` line so tests can import `.abide` files, mount them and measure their work.',
                registry: '`@abide/harness/abide/preload`',
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
                title: 'The `abide` command',
                nav: 'Commands',
                description:
                    'Scaffold, develop, check, build, serve, call, watch, compile and upgrade an abide app from the terminal.',
                registry: 'Commands',
            },
            {
                route: '/cli/bridge',
                title: '`abide-bridge`',
                nav: '`abide-bridge`',
                description:
                    "Pair your own Claude Code with an abide site's assistant, register its pairing links, and make allowed sites ask again.",
                registry: '`abide-bridge`',
            },
        ],
    },
]
