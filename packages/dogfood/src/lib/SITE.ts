// THE SITE: one page per REGISTRY `##` section — one export an app imports, or one construct it
// writes (40.2, 40.3) — grouped as REGISTRY groups them: its route, its words, and the section it
// documents (40.4). One home for what a page is CALLED and what it COVERS, so the nav, the home page's
// index, the page's own header and the coverage gates read one list. What a page SAYS is its
// `index.abide`: its examples, its See also and its Tests.

export type SitePage = {
    route: string
    /** The name it documents, or the construct it is. */
    title: string
    /** What the nav calls it. */
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

// A page as written: `nav` and `registry` are its `title` unless it says otherwise.
type WrittenPage = Omit<SitePage, 'nav' | 'registry'> & {
    nav?: string
    registry?: string
}

const WRITTEN: readonly {
    group: string
    description: string
    pages: readonly WrittenPage[]
}[] = [
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
                description:
                    'Render a string you trust as markup rather than escaped text, such as the HTML `markdown` hands back.',
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
                description:
                    'Use a component as a tag, pass markup into its slot, and declare small components inline in a file.',
            },
            {
                route: '/abide-files/props',
                title: '`props`',
                description:
                    'Take typed, live props from the markup using a component, with defaults, bound writes and element attributes passed through.',
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
        group: 'Pages and the app',
        description:
            'A file under `src` is a page at the address its path spells, inside the layouts above it, in an app that reads its environment and its files.',
        pages: [
            {
                route: '/pages/pages',
                title: 'Pages',
                description:
                    'Route pages by file path and dynamic segments, add to the document head, listen on the window, and animate between pages.',
            },
            {
                route: '/pages/render',
                title: '`render`',
                description:
                    "Render a component bound to its props into a document's bytes on the server, for a handler, an email or a file.",
            },
            {
                route: '/pages/sinks',
                title: 'Sinks',
                description:
                    'Send a page before its data lands, leaving holes in text, attributes, titles and textareas that fill as each value arrives.',
            },
            {
                route: '/pages/outlet',
                title: '`Outlet`',
                description:
                    'Leave a named place in a layout, a toolbar or a side panel, for the page under it to fill.',
            },
            {
                route: '/pages/fill',
                title: '`fill`',
                description:
                    "Put a component in a layout's named place from the page under it, painted there by the server.",
            },
            {
                route: '/app/create-app',
                title: '`createApp`',
                description:
                    'Start the app in-process with no port, and drive it through `fetch` and `run` from a test or a host.',
            },
            {
                route: '/configuration/environment',
                title: 'Environment variables',
                nav: 'Environment',
                description:
                    'Set the port, public URL, secrets, logging, offline mode and telemetry export with environment variables.',
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
        group: 'Reactive primitives',
        description:
            'One value that loads, reloads, streams and fails, and the effects and selections over it.',
        pages: [
            {
                route: '/reactive/reactive',
                title: '`reactive`',
                description:
                    'Hold a value, derive one from others, or load or stream one from a handler, with reads, writes, probes and triggers on one type.',
            },
            {
                route: '/reactive/watch',
                title: '`watch`',
                description:
                    'Run a side effect each time the values it reads change, and stop it with the disposer it returns.',
            },
            {
                route: '/reactive/store',
                title: '`store`',
                description:
                    'Keep a reactive value somewhere that outlives the process: Web Storage, a cookie, IndexedDB, SQLite, Redis, or your own.',
            },
            {
                route: '/reactive/refuse',
                title: '`refuse`',
                description:
                    'Declare a named refusal with typed data, return it from a handler, and match it by name where the call is made.',
            },
            {
                route: '/reactive/is-failed',
                title: '`isFailed`',
                description:
                    'Tell a refusal from any other value or thrown error, including one read back from JSON.',
            },
            {
                route: '/reactive/busy',
                title: '`busy`',
                description:
                    'Ask whether any value, keyed entry, handler call or tagged value in a selection has work in flight.',
            },
            {
                route: '/reactive/ready',
                title: '`ready`',
                description:
                    'Ask whether every entry in a selection has a value to serve, to show a view only once it is whole.',
            },
            {
                route: '/reactive/synced',
                title: '`synced`',
                description:
                    'Ask whether every entry in a selection still holds what its producer made, rather than a write made here.',
            },
            {
                route: '/reactive/refresh',
                title: '`refresh`',
                description:
                    'Reload a value, a keyed entry, a handler or everything carrying a tag, keeping what is held on screen meanwhile.',
            },
            {
                route: '/reactive/invalidate',
                title: '`invalidate`',
                description:
                    'Mark a selection stale so its next read loads again, without starting a load now.',
            },
            {
                route: '/reactive/flush-sync',
                title: '`flushSync`',
                description:
                    'Run every effect a write woke right now, so a test or a layout read sees the updated page.',
            },
            {
                route: '/reactive/stop-signal',
                title: '`stopSignal`',
                description:
                    "Read the signal a stopping app aborts, so a long job's run or its fetch ends early.",
            },
            {
                route: '/reactive/structural',
                title: '`structural`',
                description:
                    'Compare values by contents rather than reference, so an equal reload or write wakes nobody.',
            },
            {
                route: '/reactive/is-reactive',
                title: '`isReactive`',
                description:
                    'Check whether a value is a `Reactive`, ahead of any thenable check, since a `Reactive` is thenable.',
            },
            {
                route: '/reactive/tracking',
                title: 'Tracking',
                description:
                    'Which reads subscribe, which do not, and how to read a value without following it.',
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
                description:
                    "Read the request being answered, its headers, signal and caller's address, from anywhere in the code answering it.",
            },
            {
                route: '/ambient/response',
                title: '`response`',
                description:
                    'Set the status and headers of the answer, or fix it as a page, JSON, a redirect, or a stream.',
            },
            {
                route: '/ambient/cookies',
                title: '`cookies`',
                description:
                    'Read and write cookies by name on both sides, so the server paints what the browser chose.',
            },
            {
                route: '/ambient/route',
                title: '`route`',
                description:
                    "Read the page's address, its params and its query as reactive values, and keep page state in the address.",
            },
            {
                route: '/ambient/online',
                title: '`online`',
                description:
                    'Tell the reader the browser has lost its network, and catch up when it returns.',
            },
            {
                route: '/ambient/media',
                title: '`media`',
                description:
                    'Follow a CSS media query, such as a width or reduced motion, from script as a value a page reads.',
            },
            {
                route: '/ambient/outbox',
                title: '`outbox`',
                description:
                    'Queue writes made offline, send them in order once the server answers, and retry or drop the refused ones.',
            },
            {
                route: '/ambient/reachable',
                title: '`reachable`',
                description:
                    'Ask whether another host answers, so a handler can refuse at once while it is down.',
            },
            {
                route: '/ambient/server',
                title: '`server`',
                description:
                    'Reach the listening Bun server for what abide does not carry, such as requests in flight.',
            },
            {
                route: '/ambient/is-server',
                title: '`isServer`',
                description:
                    "Tell whether code is running in a server's request or render or in the browser, to guard browser-only APIs.",
            },
            {
                route: '/ambient/principal',
                title: '`principal`',
                description:
                    'Sign a caller in and out, read who they are, and decide in a handler what they see.',
            },
            {
                route: '/ambient/config',
                title: '`config`',
                description:
                    'Read typed settings, defaulted by `onConfig` and overridden by the environment, validated once at start.',
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
                description:
                    'Declare a read in a handler file and call it from a page as a reactive value, a stream or a link.',
            },
            {
                route: '/transports/post',
                title: '`POST`, `PUT`, `PATCH` and `DELETE`',
                nav: '`POST` and friends',
                description:
                    'Declare a write with `POST`, `PUT`, `PATCH` or `DELETE`, and refresh what it changed once it answers.',
            },
            {
                route: '/transports/mount-paths',
                title: 'Mount paths',
                description:
                    "Find the address a handler answers at from its file's path, its `[param]` segments and its `<script server>`.",
            },
            {
                route: '/transports/validate-json',
                title: '`validateJson`',
                description:
                    'Check a value against a JSON Schema document, and read what was wrong keyed by the path to it.',
            },
            {
                route: '/transports/json-schema',
                title: '`jsonSchema`',
                description:
                    "Turn a JSON Schema document into a `Schema` that gates a handler's args and is published as written.",
            },
            {
                route: '/transports/headers',
                title: 'Headers abide generates',
                nav: 'Headers',
                description:
                    'See the headers every answer carries without you writing them, and replace a default from a handler.',
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
                description:
                    'Choose which surfaces a handler is on: the page, OpenAPI, MCP and the command line.',
            },
            {
                route: '/surfaces/openapi',
                title: 'OpenAPI',
                description:
                    'Read the OpenAPI 3.1 document abide writes from your handlers, served or printed beside the code.',
            },
            {
                route: '/surfaces/mcp',
                title: 'MCP',
                description:
                    'Offer your handlers as the tools of an MCP server a model calls as the person asking.',
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
                description:
                    'Run code around every request under a route, to guard a section, gate pages or answer before routing.',
            },
            {
                route: '/hooks/on-start',
                title: '`onStart`',
                description:
                    "Run work around the app's boot, such as connecting a pool or migrating, before the first request is answered.",
            },
            {
                route: '/hooks/on-stop',
                title: '`onStop`',
                description:
                    'Close what the app opened once in-flight requests drain, on a signal, a quit or `App.stop`.',
            },
            {
                route: '/hooks/on-error',
                title: '`onError`',
                description:
                    'Send an unexpected error to a tracker, on the server under a route or in the browser under a component.',
            },
            {
                route: '/hooks/on-refusal',
                title: '`onRefusal`',
                description:
                    "Hear every refusal a browser call gets while a component stands, with the call's method, URL and trace.",
            },
            {
                route: '/hooks/on-config',
                title: '`onConfig`',
                description:
                    'Give config settings defaults a deployment overrides, and check the whole document with a schema before the app starts.',
            },
            {
                route: '/hooks/on-health',
                title: '`onHealth`',
                description:
                    "Add the app's own fields, such as a database's state, to the health check at `/__abide/health`.",
            },
            {
                route: '/hooks/on-principal',
                title: '`onPrincipal`',
                description:
                    'Turn the claims in a signed-in cookie into the member a page and a handler read.',
            },
            {
                route: '/hooks/on-pairing',
                title: '`onPairing`',
                description:
                    "Set, per person, the Claude Code arguments a pairing's command and install carry after `--`.",
            },
            {
                route: '/hooks/on-report',
                title: '`onReport`',
                description:
                    'Send each problem report a person files to your tracker, refusing the send when the tracker fails.',
            },
            {
                route: '/hooks/on-launcher',
                title: '`onLauncher`',
                description:
                    "Set the native app's window, launcher forms, menu bar extra and update feed.",
            },
        ],
    },
    {
        group: 'Overlays',
        description:
            'Dialogs, prompts, toasts, tooltips and menus, and the placing and dismissing under them.',
        pages: [
            {
                route: '/components/dialog',
                title: '`Dialog`',
                description:
                    'Open a native modal dialog from a value you bind, and learn which button closed it.',
            },
            {
                route: '/components/prompts',
                title: '`Prompts`',
                description:
                    'Render once in the root layout to show every queued confirm, alert and text prompt, one at a time.',
            },
            {
                route: '/components/prompts-api',
                title: '`prompts`',
                description:
                    'Ask a yes-or-no question, show a message or ask for a line of text, and await the answer.',
            },
            {
                route: '/components/toasts',
                title: '`Toasts`',
                description:
                    'Render once in the root layout as the live region where every notice shows and is read out.',
            },
            {
                route: '/components/toasts-api',
                title: '`toasts`',
                description:
                    'Show a notice that takes itself down, offer one action on it, or dismiss it by its id.',
            },
            {
                route: '/components/tooltips',
                title: '`Tooltips`',
                description:
                    'Render once in the root layout as the one popover every hint on the page opens in.',
            },
            {
                route: '/components/tooltip',
                title: '`tooltip`',
                description:
                    'Show a hint for the element it is bound to, on hover and on focus, placed where it fits.',
            },
            {
                route: '/components/menu',
                title: '`menu`',
                description:
                    'Open a list of actions from a button of your own, walked by the arrow keys and closed by a pick.',
            },
            {
                route: '/helpers/dismissible',
                title: '`dismissible`',
                description:
                    'Close a panel or popover when someone presses outside it or hits Escape.',
            },
            {
                route: '/helpers/place',
                title: '`place`',
                description:
                    'Work out where a popover or hint sits beside its anchor, flipped and kept inside the viewport, without writing to the page.',
            },
            {
                route: '/helpers/popover',
                title: '`popover`',
                description:
                    'Open a panel of your own in the top layer against the button or field it belongs to, and keep it there as the page moves.',
            },
        ],
    },
    {
        group: 'Input and lists',
        description:
            'Forms, pickers, tabs and sortable tables, and the keys, drops and copies a page takes.',
        pages: [
            {
                route: '/helpers/form',
                title: '`form`',
                description:
                    'Check a form against the handler it submits to before calling it, and show what is wrong beside each field.',
            },
            {
                route: '/components/combobox',
                title: '`Combobox`',
                description:
                    'Pick one item from a list narrowed or searched on the server as someone types.',
            },
            {
                route: '/components/command-palette',
                title: '`CommandPalette`',
                description:
                    'Open a search over what the app can do on one key, and run the command picked.',
            },
            {
                route: '/components/tabs',
                title: '`tabs`',
                description:
                    'Switch between views from a row of tabs of your own that the arrow keys move along.',
            },
            {
                route: '/components/range',
                title: '`Range`',
                description:
                    'Pick a low and a high value on one track, by dragging either thumb or with the arrow keys.',
            },
            {
                route: '/helpers/range',
                title: '`range`',
                description:
                    'Spread a two-thumb range onto markup of your own: the group, the track, the span and each thumb.',
            },
            {
                route: '/helpers/tree',
                title: '`tree`',
                description:
                    'Show nested records as a tree of your own that the arrow keys open, close and move through.',
            },
            {
                route: '/components/sortable-table',
                title: '`SortableTable`',
                description:
                    'Show rows in a table whose headers sort them, moving rows rather than rebuilding them.',
            },
            {
                route: '/helpers/listbox',
                title: '`listbox`',
                description:
                    'Put arrow-key, Home, End, Enter and Escape handling on a list of options you render yourself.',
            },
            {
                route: '/helpers/sort-rows',
                title: '`sortRows`',
                description:
                    'Sort table rows by a column and direction, numbers as numbers, dates by time and blanks last.',
            },
            {
                route: '/helpers/virtual-rows',
                title: '`virtualRows`',
                description:
                    'Render only the rows of a long list that are in view, so ten thousand rows mount as fast as twenty.',
            },
            {
                route: '/helpers/hotkeys',
                title: '`hotkeys`',
                description:
                    'Map key presses to commands with one `keydown` listener that stands aside while the visitor types.',
            },
            {
                route: '/helpers/key-label',
                title: '`keyLabel`',
                description:
                    "Write a shortcut binding as the visitor's platform shows it, ⌘ on a Mac and Ctrl elsewhere.",
            },
            {
                route: '/helpers/is-editable-target',
                title: '`isEditableTarget`',
                description:
                    'Check whether a key event landed in a field the visitor types into, before a listener of your own acts on it.',
            },
            {
                route: '/helpers/dropzone',
                title: '`dropzone`',
                description:
                    'Take the files dropped on an element, or pasted into it, filtered by type, and highlight the target while files hover.',
            },
            {
                route: '/helpers/copy-text',
                title: '`copyText`',
                description:
                    'Copy text to the clipboard when an element is clicked, and mark the element while the copy shows.',
            },
        ],
    },
    {
        group: 'Charts',
        description:
            'Lines, columns, areas, pies and sparklines drawn in SVG, and the scales and paths under them.',
        pages: [
            {
                route: '/components/chart',
                title: '`Chart`',
                description:
                    'Plot lines, columns and areas over one pair of axes, stacked or as shares, with a crosshair that reads each one out.',
            },
            {
                route: '/components/series',
                title: '`Line`, `Column` and `Area`',
                nav: 'Chart series',
                description:
                    'Declare the series a chart draws, each as a line, a column per value or a filled area, and the stack it piles into.',
            },
            {
                route: '/components/pie',
                title: '`Pie`',
                description:
                    'Show shares of a whole as the slices of a pie or a donut, each reading its value and share on hover.',
            },
            {
                route: '/components/sparkline',
                title: '`Sparkline`',
                description:
                    'Draw a trend with no axes into any box, marked by its direction for styling.',
            },
            {
                route: '/helpers/chart',
                title: '`chart`',
                description:
                    'Compute round ticks, linear scales, SVG paths with gaps, and the point nearest the pointer for a chart of your own.',
            },
        ],
    },
    {
        group: 'Content',
        description:
            'Markdown, a chat transcript, formatted values and messages read to a screen reader, and elements that follow what they hold or how big they are.',
        pages: [
            {
                route: '/components/markdown',
                title: '`Markdown`',
                description:
                    'Render markdown as safe markup, a section at a time, so a streamed source redraws only its growing end.',
            },
            {
                route: '/helpers/markdown',
                title: '`markdown`',
                description:
                    'Turn markdown into HTML safe to hand `raw`, with its HTML escaped and unsafe links reduced to text.',
            },
            {
                route: '/components/chat',
                title: '`Chat`',
                description:
                    'Put a streaming conversation with your assistant handler on a page, with a composer, Stop and tool permissions.',
            },
            {
                route: '/components/announcer',
                title: '`Announcer`',
                description:
                    'Render once in the root layout as the live regions a screen reader reads every announced message from.',
            },
            {
                route: '/components/announce',
                title: '`announce`',
                description:
                    'Tell a screen reader what changed where nothing on screen says it, politely or interrupting.',
            },
            {
                route: '/helpers/format',
                title: '`format`',
                description:
                    'Write money, percents, counts, lists, dates and durations the same on server and browser, with a dash for missing values.',
            },
            {
                route: '/components/time',
                title: '`Time`',
                description:
                    'Show how long ago or how soon a time is, kept current by one clock for the whole page.',
            },
            {
                route: '/helpers/follow-bottom',
                title: '`followBottom`',
                description:
                    'Keep a scrolling log or transcript at its newest line as lines arrive, until the reader scrolls up to an earlier one.',
            },
            {
                route: '/helpers/observe',
                title: '`observe`',
                description:
                    "Bind an element's size, visibility or position to reactive values a template reads.",
            },
        ],
    },
    {
        group: 'Data and I/O',
        description:
            'The database, fetches and handled calls, background jobs, and the addresses a page builds and goes to.',
        pages: [
            {
                route: '/helpers/database',
                title: '`database`',
                description:
                    "Open the app's SQLite file where the deployment keeps its data, and run each migration once, in order.",
            },
            {
                route: '/helpers/fetch-json',
                title: '`fetchJson`',
                description:
                    'Ask another service for JSON with a deadline, retries and an optional cache, and get a refusal rather than a throw when it gives up.',
            },
            {
                route: '/helpers/fetch-text',
                title: '`fetchText`',
                description:
                    'Ask another service for a text answer with a deadline, retries and an optional cache, and get a refusal when it gives up.',
            },
            {
                route: '/helpers/handle',
                title: '`handle`',
                description:
                    'Read a response you fetched yourself as its type says: JSON, a stream of chunks, text or bytes.',
            },
            {
                route: '/helpers/job',
                title: '`job`',
                description:
                    'Run work on the server on a schedule, one run at a time, with a status every page can read.',
            },
            {
                route: '/helpers/url',
                title: '`url`',
                description:
                    'Build a typed address from the route a page is filed under, with its query, right under any mount path.',
            },
            {
                route: '/helpers/navigate',
                title: '`navigate`',
                description:
                    'Go to another page from script without reloading, or step back and forward through the history.',
            },
        ],
    },
    {
        group: 'Identity and access',
        description:
            'Who is signed in, the role they hold, the identities a server trusts, and what a page may write and load.',
        pages: [
            {
                route: '/helpers/signed-in',
                title: '`signedIn`',
                description:
                    'Refuse a handler to anyone not signed in, answering `SignedOut` at 401 before the body runs.',
            },
            {
                route: '/helpers/require-role',
                title: '`requireRole`',
                description:
                    'Admit only signed-in callers with a role, or ones a test of the principal passes, refusing the rest `Forbidden` at 403.',
            },
            {
                route: '/helpers/trusted-identity',
                title: '`trustedIdentity`',
                description:
                    'Sign in the caller a single sign-on proxy in front of the app names in a header, believed from that proxy alone.',
            },
            {
                route: '/helpers/read-only',
                title: '`readOnly`',
                description:
                    'Refuse every write below a route or to a handler, keeping open the handlers you allow.',
            },
            {
                route: '/helpers/csp',
                title: '`csp`',
                description:
                    "Admit only the app's own scripts and styles with a content security policy, and read the nonce for an inline script.",
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
                description:
                    'Stream a conversation with a model whose tools are your handlers, from a handler you write.',
            },
            {
                route: '/ai/results-of',
                title: '`resultsOf`',
                description:
                    "Read what a conversation's calls to one handler answered, typed as that handler's value.",
            },
            {
                route: '/ai/image-piece',
                title: '`imagePiece`',
                description:
                    'Turn an image into a piece of a turn, drawn down to what a model looks at.',
            },
            {
                route: '/ai/image-files',
                title: '`imageFiles`',
                description:
                    'Take the images a model is shown from a paste or a drop.',
            },
            {
                route: '/ai/provider',
                title: '`provider`',
                description:
                    "Run the conversation on the Claude API, or on the visitor's own Claude Code through the bridge.",
            },
            {
                route: '/ai/pairing',
                title: '`pairing`',
                description:
                    "Pair this browser with the visitor's Claude Code with a click, and follow the pairing's status.",
            },
            {
                route: '/ai/transcript',
                title: '`transcript`',
                description:
                    'Fold a streamed answer into the turns a chat shows, and send them back as messages.',
            },
            {
                route: '/components/pairing',
                title: '`Pairing`',
                description:
                    "Pair the visitor's Claude Code with the page, and render what you put inside once it is paired.",
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
                description:
                    "Tell the native app's window from a browser, and drag the window by a header drawn under its controls.",
            },
            {
                route: '/native-app/pending-update',
                title: '`pendingUpdate`',
                description:
                    'Show the update the native window has staged, and restart into it.',
            },
            {
                route: '/native-app/on-menu',
                title: '`onMenu`',
                description:
                    "Add menus to the native app's menu bar while a layout or page stands, following the values they read.",
            },
            {
                route: '/native-app/menu-item',
                title: '`menuItem`',
                description:
                    'Make a menu bar entry that runs your function when picked, or one the platform performs by role.',
            },
        ],
    },
    {
        group: 'Operating',
        description:
            'Logs, problem reports, traces and health checks for an app that is running.',
        pages: [
            {
                route: '/helpers/log',
                title: '`log`',
                description:
                    'Write leveled lines under a named namespace, turned on with `DEBUG` on the server and in the browser.',
            },
            {
                route: '/helpers/report',
                title: '`report`',
                description:
                    "Start a problem report from a failed call's trace, let the person read every word, and send it to `onReport`.",
            },
            {
                route: '/ambient/trace',
                title: '`trace`',
                description:
                    'Follow one request through every handler, log line and outbound call with one trace id, and time its spans.',
            },
            {
                route: '/ambient/health',
                title: '`health`',
                description:
                    "Read the app's health report, the same one a load balancer polls, with your own fields beside the baseline.",
            },
        ],
    },
    {
        group: 'Testing and measurement',
        description:
            'Mount a component in `bun test`, wait for what it loads, and count, time and gate what it does with the harness abide is measured with.',
        pages: [
            {
                route: '/testing/mount',
                title: '`mount`',
                description:
                    'Render and hydrate a component in `bun test`, then click it and read what it rendered.',
            },
            {
                route: '/testing/settled',
                title: '`settled`',
                description:
                    'Wait in a test until every load and effect a click started has finished, instead of sleeping.',
            },
            {
                route: '/harness/measure/measure',
                title: '`measure`',
                description:
                    'Count what an op did to the DOM, rows moved, nodes created, text and class writes, and what your own code published while it ran.',
                registry: '`measure` — `@abide/harness/measure`',
            },
            {
                route: '/harness/measure/published-by',
                title: '`publishedBy`',
                description:
                    "Read one source's published counters off a `Work`, or `null` when nothing was published.",
                registry: '`publishedBy` — `@abide/harness/measure`',
            },
            {
                route: '/harness/measure/published-work-key',
                title: '`PUBLISHED_WORK_KEY`',
                description:
                    'Publish your own counters under this global so `measure` zeroes them per case and copies them into its result.',
                registry: '`PUBLISHED_WORK_KEY` — `@abide/harness/measure`',
            },
            {
                route: '/harness/measure/time',
                title: '`time`',
                description:
                    'Time several arms of an op in one interleaved batch, refused while counting and on an emulated DOM.',
                registry: '`time` — `@abide/harness/measure`',
            },
            {
                route: '/harness/measure/patch-set',
                title: '`patchSet`',
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
            },
            {
                route: '/harness/engine/trace-op',
                title: '`traceOp`',
                description:
                    'Trace one op in a Chromium page from Playwright, and read its style, layout, paint and forced-layout counts and its user timing.',
                registry: '`traceOp` — `@abide/harness/engine`',
            },
            {
                route: '/harness/engine/shares',
                title: '`shares`',
                description:
                    'Find what fraction of a whole op one measured layer took, and whether a person would see the saving.',
                registry: '`shares` — `@abide/harness/engine`',
            },
            {
                route: '/harness/engine/measures-named',
                title: '`measuresNamed`',
                description:
                    'List every user-timing measure in a trace with one name, in trace order.',
                registry: '`measuresNamed` — `@abide/harness/engine`',
            },
            {
                route: '/harness/engine/duration-of',
                title: '`durationOf`',
                description:
                    'Sum the nanoseconds of every measure with one name in a trace.',
                registry: '`durationOf` — `@abide/harness/engine`',
            },
            {
                route: '/harness/server/bytes',
                title: '`bytes`',
                description:
                    "Measure what a response, string or buffer sends, or estimate an object's memory, to compare a render across sizes.",
                registry: '`bytes` — `@abide/harness/server`',
            },
            {
                route: '/harness/server/ticks',
                title: '`ticks`',
                description:
                    "Count the microtask turns a call's result takes to settle.",
                registry: '`ticks` — `@abide/harness/server`',
            },
            {
                route: '/harness/server/retained',
                title: '`retained`',
                description:
                    'Diff the live objects a call leaves behind, by engine type, in a process with no DOM.',
                registry: '`retained` — `@abide/harness/server`',
            },
            {
                route: '/harness/server/retained-per-run',
                title: '`retainedPerRun`',
                description:
                    'Find what each run of a call keeps reachable, as a batch mean, and whether that grows across the batch.',
                registry: '`retainedPerRun` — `@abide/harness/server`',
            },
            {
                route: '/harness/server/closures',
                title: '`closures`',
                description:
                    'Count the functions and scopes a call leaves behind, as the pair the engine reports a closure as.',
                registry: '`closures` — `@abide/harness/server`',
            },
            {
                route: '/harness/report/batch',
                title: '`batch`',
                description:
                    'Time each arm of an op in interleaved batches sized to the clock, with an A/A floor that says how much difference is noise.',
                registry: '`batch` — `@abide/harness/report`',
            },
            {
                route: '/harness/report/ratio',
                title: '`ratio`',
                description:
                    "Divide one arm's time by another's, getting a number only when the difference clears the floor and a frame.",
                registry: '`ratio` — `@abide/harness/report`',
            },
            {
                route: '/harness/report/claim-of',
                title: '`claimOf`',
                description:
                    'Print a `ratio` verdict as the one line a bench report shows: a ratio, or why there is none.',
                registry: '`claimOf` — `@abide/harness/report`',
            },
            {
                route: '/harness/report/emulated-dom',
                title: '`emulatedDom`',
                description:
                    'Tell `batch` whether a timed op touched an emulated DOM, so a happy-dom duration is refused rather than quoted.',
                registry: '`emulatedDom` — `@abide/harness/report`',
            },
            {
                route: '/harness/report/thresholds',
                title: '`THRESHOLDS`',
                description:
                    'Judge a cost against one frame and the interaction budget, the two lines where a wait becomes visible.',
                registry: '`THRESHOLDS` — `@abide/harness/report`',
            },
            {
                route: '/harness/gate/gate',
                title: '`gate`',
                description:
                    'Write a test that carries its own revert, and prove it fails reporting the number the old version did.',
                registry: '`gate` — `@abide/harness/gate`',
            },
            {
                route: '/harness/gate/spawned',
                title: '`spawned`',
                description:
                    'Run a child process from a test, awaited, killed at a deadline that fails the test naming the command.',
                registry: '`spawned` — `@abide/harness/gate`',
            },
            {
                route: '/harness/gate/at-most',
                title: '`atMost`',
                description:
                    'Hold a measured op to a ceiling per counter, failing from your line with every field that went over.',
                registry: '`atMost` — `@abide/harness/gate`',
            },
            {
                route: '/harness/gate/in-a-fresh-process',
                title: '`inAFreshProcess`',
                description:
                    'Run source in a child bun with no DOM preloaded and no worker mark, for a check the test process would skew.',
                registry: '`inAFreshProcess` — `@abide/harness/gate`',
            },
            {
                route: '/harness/rows/in-scope',
                title: '`inScope`',
                description:
                    'Select runner rows by `--scope`: all of them, one section, or one item.',
                registry: '`inScope` — `@abide/harness/rows`',
            },
            {
                route: '/harness/rows/matches-filter',
                title: '`matchesFilter`',
                description:
                    'Filter rows by typed text, matched case-insensitively against section and name, the same way the runner selects.',
                registry: '`matchesFilter` — `@abide/harness/rows`',
            },
            {
                route: '/harness/runner/rows-command',
                title: '`rowsCommand`',
                description:
                    'Turn a list of items into a runner command that lists its catalog or streams one JSON row per result.',
                registry: '`rowsCommand` — `@abide/harness/runner`',
            },
            {
                route: '/harness/runner/test-rows',
                title: '`testRows`',
                description:
                    "Run an app's test files one process each, printing a `TestRow` per file as it finishes.",
                registry: '`testRows` — `@abide/harness/runner`',
            },
            {
                route: '/harness/runner/run-benches',
                title: '`runBenches`',
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
                description:
                    "Pair your own Claude Code with an abide site's assistant, register its pairing links, and make allowed sites ask again.",
            },
        ],
    },
]

/** Every group of the site, each page's `nav` and `registry` filled in. */
export const SITE: readonly SiteGroup[] = WRITTEN.map((written) => ({
    ...written,
    pages: written.pages.map((page) => ({
        ...page,
        nav: page.nav ?? page.title,
        registry: page.registry ?? page.title,
    })),
}))
