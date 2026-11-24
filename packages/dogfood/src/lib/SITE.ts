// THE SITE: one page per REGISTRY `##` section — one export an app imports, or one construct it
// writes (40.2, 40.3) — grouped as REGISTRY groups them: its route, its words, the section it
// documents (40.4) and where a reader reaches for it (40.36). One home for what a page is CALLED and
// what it COVERS, so the nav, the home page's index, the page's own header and the coverage gates
// read one list. What a page SAYS is its `index.abide`: its examples, its See also and its Tests.

/** Where a page's name is written and where it runs (40.36). */
export type Where =
    'component' | 'browser' | 'server' | 'anywhere' | 'test' | 'terminal'

/** What a page's header says of where it is reached for, and the nav's mark for it. */
export const WHERE: Readonly<
    Record<Where, { runs: string; written: string; mark: string | undefined }>
> = {
    component: {
        runs: 'in the browser and on the server',
        written: 'a `.abide` file',
        mark: undefined,
    },
    browser: {
        runs: 'in the browser',
        written: 'a `.abide` file',
        mark: 'browser',
    },
    server: {
        runs: 'on the server',
        written: 'a `<script server>` block, a handler or a `.server.ts` file',
        mark: 'server',
    },
    anywhere: {
        runs: 'in the browser and on the server',
        written: 'any module',
        mark: undefined,
    },
    test: { runs: 'under `bun test`', written: 'a test file', mark: undefined },
    terminal: { runs: 'in a terminal', written: 'a shell', mark: undefined },
}

export type SitePage = {
    route: string
    /** A guide: how the group's names fit together, documenting no REGISTRY section (40.39). */
    guide: boolean
    /** The name it documents, or the construct it is. */
    title: string
    /** What the nav calls it. */
    nav: string
    /** One sentence: what you use it for. The home page's index lists it under the page. */
    description: string
    /** The REGISTRY `##` heading whose rows this page carries. */
    registry: string
    where: Where
    /** The run of pages in its group it is listed under in the nav, where the group has runs. */
    subgroup: string | undefined
}

/**
 * What a group's examples prove, which decides what a page shows beside each example and the order
 * of its parts (40.9, 40.40-40.45): a pure function by its call, a construct by being written, a
 * headless component by the markup it makes and the rules that style it, a reactive value by the
 * work it wakes, a server name by a real request and its answer, and a command by what it printed.
 */
export type Form =
    'reference' | 'authoring' | 'anatomy' | 'work' | 'exchange' | 'transcript'

export type SiteGroup = {
    group: string
    /** One sentence: what the pages in it have in common. */
    description: string
    form: Form
    pages: readonly SitePage[]
}

// A page as written: `nav` and `registry` are its `title` unless it says otherwise.
// A guide documents no section, so its `registry` is `''`.
type WrittenPage = Omit<SitePage, 'nav' | 'registry' | 'subgroup' | 'guide'> & {
    nav?: string
    registry?: string
    subgroup?: string
    guide?: true
}

const WRITTEN: readonly {
    group: string
    description: string
    form: Form
    pages: readonly WrittenPage[]
}[] = [
    {
        group: '`.abide` files',
        description:
            'A component is a `.abide` file: script blocks, markup, and the reactive values it reads by name.',
        form: 'authoring',
        pages: [
            {
                route: '/abide-files',
                title: 'Writing a component',
                nav: 'Writing a component',
                description:
                    'Build one component of the CRM a step at a time: markup, values read by name, a list, a prop, a server read and scoped styles.',
                where: 'component',
                guide: true,
            },
            {
                route: '/abide-files/by-name',
                title: 'Reading and writing by name',
                nav: 'Values by name',
                description:
                    'Read a reactive value by naming it and write it by assigning, with the explicit calls still compiling.',
                where: 'component',
            },
            {
                route: '/abide-files/expressions',
                title: 'Expressions and attributes',
                nav: 'Expressions',
                description:
                    'Put live values into text, attributes, listeners, classes and styles, and bind form fields both ways.',
                registry: 'Expressions',
                where: 'component',
            },
            {
                route: '/abide-files/raw',
                title: '`raw`',
                description:
                    'Render a string you trust as markup rather than escaped text, such as the HTML `markdown` hands back.',
                where: 'component',
            },
            {
                route: '/abide-files/control-flow',
                title: '`{#if}`, `{#for}` and `{#try}`',
                nav: 'Control flow',
                description:
                    'Show markup on a condition, repeat it over a keyed list, and hold a placeholder or fallback while a region loads or fails.',
                registry: 'Control flow',
                where: 'component',
            },
            {
                route: '/abide-files/components',
                title: 'Components and slots',
                description:
                    'Use a component as a tag, pass markup into its slot, and declare small components inline in a file.',
                where: 'component',
            },
            {
                route: '/abide-files/props',
                title: '`props`',
                description:
                    'Take typed, live props from the markup using a component, with defaults, bound writes and element attributes passed through.',
                where: 'component',
            },
            {
                route: '/abide-files/blocks',
                title: '`<script>` and `<style>` blocks',
                nav: 'Script and style',
                description:
                    'Split a component into per-instance setup, module scope, server-only code and scoped styles.',
                registry: 'Script and style blocks',
                where: 'component',
            },
        ],
    },
    {
        group: 'Pages and routing',
        description:
            'A file under `src` is a page at the address its path spells, inside the layouts above it, and a page reads where it is and goes elsewhere.',
        form: 'authoring',
        pages: [
            {
                route: '/pages',
                title: 'Organizing a site by its files',
                nav: 'Organizing a site',
                description:
                    "Lay out an app's directories so its pages, layouts, handlers and private code each land where a reader of the tree expects them.",
                where: 'component',
                guide: true,
            },
            {
                route: '/pages/pages',
                title: 'Pages',
                description:
                    'Route pages by file path and dynamic segments, add to the document head, listen on the window, and animate between pages.',
                where: 'component',
            },
            {
                route: '/pages/files',
                title: 'Files abide reads',
                nav: 'Files',
                description:
                    "Lay out the app so each file's path decides its address, its side and its role, and configure the build in `bunfig.toml`.",
                registry: 'Files',
                where: 'component',
            },
            {
                route: '/pages/render',
                title: '`render`',
                description:
                    "Render a component bound to its props into a document's bytes on the server, for a handler, an email or a file.",
                where: 'server',
            },
            {
                route: '/pages/sinks',
                title: 'Sinks',
                description:
                    'Send a page before its data lands, leaving holes in text, attributes, titles and textareas that fill as each value arrives.',
                where: 'component',
            },
            {
                route: '/pages/route',
                title: '`route`',
                description:
                    "Read the page's address, its params and its query as reactive values, and keep page state in the address.",
                where: 'anywhere',
            },
            {
                route: '/pages/url',
                title: '`url`',
                description:
                    'Build a typed address from the route a page is filed under, with its query, right under any mount path.',
                where: 'anywhere',
            },
            {
                route: '/pages/navigate',
                title: '`navigate`',
                description:
                    'Go to another page from script without reloading, or step back and forward through the history.',
                where: 'browser',
            },
        ],
    },
    {
        group: 'Reactive primitives',
        description:
            'One value that loads, reloads, streams and fails, and the effects and selections over it.',
        form: 'work',
        pages: [
            {
                route: '/reactive',
                title: 'How reactive values work together',
                nav: 'Reactive values together',
                description:
                    'Follow one figure from a value you hold through a derived total, a load from the server and an effect, and count the work each change does.',
                where: 'anywhere',
                guide: true,
            },
            {
                route: '/reactive/reactive',
                title: '`reactive`',
                description:
                    'Hold a value the page owns, a function included, with reads, writes, probes and triggers on one type.',
                where: 'anywhere',
            },
            {
                route: '/reactive/memo',
                title: '`memo`',
                description:
                    'Derive a value from others, or load or stream one from a handler, keyed by args where the body takes them.',
                where: 'anywhere',
            },
            {
                route: '/reactive/pipe',
                title: '`pipe`',
                description:
                    'Run each item through steps in order and at once, a few at a time, retried, timed out and paused, as a function or a stream.',
                where: 'anywhere',
            },
            {
                route: '/reactive/ledger',
                title: '`ledger`',
                description:
                    'Append events that are never coalesced, and read them in order from a position or a named cursor that resumes.',
                where: 'anywhere',
            },
            {
                route: '/reactive/watch',
                title: '`watch`',
                description:
                    'Run a side effect each time the values it reads change, and stop it with the disposer it returns.',
                where: 'anywhere',
            },
            {
                route: '/reactive/store',
                title: '`store`',
                description:
                    'Keep a reactive value somewhere that outlives the process: Web Storage, a cookie, IndexedDB, SQLite, Redis, or your own.',
                where: 'anywhere',
            },
            {
                route: '/reactive/refuse',
                title: '`refuse`',
                description:
                    'Declare a named refusal with typed data, return it from a handler, and match it by name where the call is made.',
                where: 'anywhere',
            },
            {
                route: '/reactive/is-failed',
                title: '`isFailed`',
                description:
                    'Tell a refusal from any other value or thrown error, including one read back from JSON.',
                where: 'anywhere',
            },
            {
                route: '/reactive/busy',
                title: '`busy`',
                description:
                    'Ask whether any value, keyed entry, handler call or tagged value in a selection has work in flight.',
                where: 'anywhere',
            },
            {
                route: '/reactive/ready',
                title: '`ready`',
                description:
                    'Ask whether every entry in a selection has a value to serve, to show a view only once it is whole.',
                where: 'anywhere',
            },
            {
                route: '/reactive/synced',
                title: '`synced`',
                description:
                    'Ask whether every entry in a selection still holds what its producer made, rather than a write made here.',
                where: 'anywhere',
            },
            {
                route: '/reactive/refresh',
                title: '`refresh`',
                description:
                    'Reload a value, a keyed entry, a handler or everything carrying a tag, keeping what is held on screen meanwhile.',
                where: 'anywhere',
            },
            {
                route: '/reactive/invalidate',
                title: '`invalidate`',
                description:
                    'Mark a selection stale so its next read loads again, without starting a load now.',
                where: 'anywhere',
            },
            {
                route: '/reactive/is-reactive',
                title: '`isReactive`',
                description:
                    'Check whether a value is a `Reactive`, ahead of any thenable check, since a `Reactive` is thenable.',
                where: 'anywhere',
            },
            {
                route: '/reactive/tracking',
                title: 'Tracking',
                description:
                    'Which reads subscribe, which do not, and how to read a value without following it.',
                where: 'anywhere',
            },
        ],
    },
    {
        group: 'Headless components',
        description:
            'Dialogs, pickers, tables and charts as parts a component spreads onto markup of its own, with the keyboard, the ARIA and the state handled and the look left to the app.',
        form: 'anatomy',
        pages: [
            {
                route: '/headless',
                title: 'Styling a headless component',
                nav: 'Styling headless parts',
                description:
                    "Style the parts a headless component spreads by the `data-` attributes they carry, with Tailwind's variants or plain CSS.",
                where: 'component',
                guide: true,
            },
            {
                route: '/headless/dialog',
                title: '`dialog`',
                description:
                    'Spread a native modal onto a `<dialog>`, opened and closed by a value you hold.',
                where: 'component',
                subgroup: 'Overlays',
            },
            {
                route: '/headless/prompts',
                title: '`prompts`',
                description:
                    'Ask a yes-or-no question, show a message or ask for a line of text, and await the answer.',
                where: 'component',
                subgroup: 'Overlays',
            },
            {
                route: '/headless/notices',
                title: '`notices`',
                description:
                    'Build a list of notices: a banner seeded on the server, its dismissals remembered for as long as you say.',
                where: 'component',
                subgroup: 'Overlays',
            },
            {
                route: '/headless/toasts',
                title: '`toasts`',
                description:
                    'Show a notice that takes itself down, offer one action on it, or dismiss it by its id.',
                where: 'component',
                subgroup: 'Overlays',
            },
            {
                route: '/headless/announce',
                title: '`announce`',
                description:
                    'Tell a screen reader what changed where nothing on screen says it, politely or interrupting.',
                where: 'component',
                subgroup: 'Overlays',
            },
            {
                route: '/headless/tooltip',
                title: '`tooltip`',
                description:
                    'Show a text hint for the element it is bound to, on hover and on focus, placed where it fits.',
                where: 'component',
                subgroup: 'Overlays',
            },
            {
                route: '/headless/menu',
                title: '`menu`',
                description:
                    'Open a list of actions from a button, walked by the arrow keys and closed by a pick.',
                where: 'component',
                subgroup: 'Overlays',
            },
            {
                route: '/headless/popover',
                title: '`popover`',
                description:
                    'Open a panel in the top layer against the button or field it belongs to, and keep it there as the page moves.',
                where: 'component',
                subgroup: 'Overlays',
            },
            {
                route: '/headless/drawer',
                title: '`drawer`',
                description:
                    'Open a dialog from an edge of the page, sized from a handle on its inner edge and settling at the sizes you give.',
                where: 'component',
                subgroup: 'Overlays',
            },
            {
                route: '/headless/lightbox',
                title: '`lightbox`',
                description:
                    'Open a set of pictures full-screen, resting on the one picked, stepped with the arrow keys.',
                where: 'component',
                subgroup: 'Overlays',
            },
            {
                route: '/headless/command-palette',
                title: '`commandPalette`',
                description:
                    'Spread a search over commands onto a dialog and a list, opened on one key.',
                where: 'component',
                subgroup: 'Overlays',
            },
            {
                route: '/headless/outlet',
                title: '`outlet`',
                description:
                    "Leave a named place in a layout, a toolbar or a side panel, and fill it with the page's own markup from below.",
                where: 'component',
                subgroup: 'Overlays',
            },
            {
                route: '/headless/form',
                title: '`form`',
                description:
                    'Check a form against the handler it submits to before calling it, show what is wrong beside each field, and mark what an edit changed.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/dropzone',
                title: '`dropzone`',
                description:
                    'Take the files dropped on an element, or pasted into it, filtered by type, and highlight the target while files hover.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/inline-edit',
                title: '`inlineEdit`',
                description:
                    'Edit a value where it stands: text that a press turns into a field, saved on Enter and undone by Escape.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/stepper',
                title: '`stepper`',
                description:
                    'Step a number up and down from a field and two buttons, kept to its bounds and its step.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/combobox',
                title: '`combobox`',
                description:
                    'Spread a field that lists what matches onto markup, each option and chip written by you.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/tabs',
                title: '`tabs`',
                description:
                    'Switch between views from a row of tabs that the arrow keys move along.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/toggle',
                title: '`toggle`',
                description:
                    'Spread a button that stays pressed, or an on/off switch, onto a button.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/toggle-group',
                title: '`toggleGroup`',
                description:
                    'Pick one key from a segmented control, or many from a row of chips, spread onto buttons.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/disclosure',
                title: '`disclosure`',
                description:
                    'Show and hide a region from a button, the region still found by find in page.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/accordion',
                title: '`accordion`',
                description:
                    'Stack sections that open one at a time, or several at once, each a disclosure.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/clamp',
                title: '`clamp`',
                description:
                    'Cut text to a few lines, and show the rest from a button only where there is more.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/spoiler',
                title: '`spoiler`',
                description:
                    'Cover content with a button in its place, hidden from find in page and screen readers until pressed.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/pages',
                title: '`pages`',
                description:
                    'Page through a long list with numbered links or buttons, the far pages folded into gaps.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/playback',
                title: '`playback`',
                description:
                    'Replay anything over time from a play button, a scrubber and speeds, driven by one clock.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/breadcrumbs',
                title: '`breadcrumbs`',
                description:
                    'Show where a page stands as a trail of links, the middle folded into a menu when it runs long.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/scroll-spy',
                title: '`scrollSpy`',
                description:
                    'Mark the section of a long page scrolled to in a nav of links, each landing its section below any sticky header.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/wizard',
                title: '`wizard`',
                description:
                    'Take a task in steps, going on only once each is done, with a meter of how far it has come.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/sortable-list',
                title: '`sortableList`',
                description:
                    'Put a list in order by dragging a handle or with the keys, each move read out to a screen reader.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/tree',
                title: '`tree`',
                description:
                    'Show nested records as a tree that the arrow keys open, close and move through.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/json-inspector',
                title: '`jsonInspector`',
                description:
                    'Search a JSON value and open it row by row in a tree, each row told apart by its pointer.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/range',
                title: '`range`',
                description:
                    'Spread a two-thumb range onto markup: the group, the track, the span and each thumb.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/resizable',
                title: '`resizable`',
                description:
                    'Size a panel by dragging its edge or with the arrow keys, kept within the room its parent leaves.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/pan-zoom',
                title: '`panZoom`',
                description:
                    'Move and magnify a map, a plan or a drawing with the wheel, a drag, a pinch or the keys.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/listbox',
                title: '`listbox`',
                description:
                    'Put arrow-key, Home, End, Enter and Escape handling on a list of options you render yourself.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/calendar',
                title: '`calendar`',
                description:
                    'Spread months of days onto grids, a day or a range picked by click or by the arrow keys.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/carousel',
                title: '`carousel`',
                description:
                    'Swipe through records in a row that snaps to each one, resting on the one picked and saying which is current as you scroll.',
                where: 'component',
                subgroup: 'Inputs',
            },
            {
                route: '/headless/sortable-table',
                title: '`sortableTable`',
                description:
                    'Spread a sortable table onto markup, writing every cell, with rows picked by checkbox.',
                where: 'component',
                subgroup: 'Data',
            },
            {
                route: '/headless/virtual-list',
                title: '`virtualList`',
                description:
                    'Render only the items of a long list or grid that are in view, measured from your own markup, with a jump to each section.',
                where: 'component',
                subgroup: 'Data',
            },
            {
                route: '/headless/time',
                title: '`time`',
                description:
                    'Spread a time kept current onto a `<time>`, one per row of a list.',
                where: 'component',
                subgroup: 'Data',
            },
            {
                route: '/headless/chat',
                title: '`chat`',
                description:
                    'Spread a streaming conversation with your assistant handler onto markup: turns, a composer, Stop and tool permissions.',
                where: 'component',
                subgroup: 'Data',
            },
            {
                route: '/headless/autoscroll',
                title: '`autoscroll`',
                description:
                    'Keep a scrolling log or transcript at its newest line as lines arrive, until the reader scrolls up to an earlier one.',
                where: 'component',
                subgroup: 'Data',
            },
            {
                route: '/headless/chart',
                title: '`chart`',
                description:
                    'Draw a chart in markup from the geometry and parts it hands back, or compute its ticks, scales and paths yourself.',
                where: 'component',
                subgroup: 'Charts',
            },
            {
                route: '/headless/pie',
                title: '`pie`',
                description:
                    'Draw shares of a whole in markup from the slices and parts it hands back.',
                where: 'component',
                subgroup: 'Charts',
            },
            {
                route: '/headless/sparkline',
                title: '`sparkline`',
                description:
                    'Draw a trend with no axes in markup from the parts it hands back.',
                where: 'component',
                subgroup: 'Charts',
            },
            {
                route: '/headless/meter',
                title: '`meter`',
                description:
                    'Show a value within its range, or progress toward an end, as a track and a fill.',
                where: 'component',
                subgroup: 'Charts',
            },
        ],
    },
    {
        group: 'Element behaviors',
        description:
            'One behavior added to an element the app already has: dismissing, copying, keys, scroll edges and observing.',
        form: 'anatomy',
        pages: [
            {
                route: '/behaviors/dismissible',
                title: '`dismissible`',
                description:
                    'Close a panel or popover when someone presses outside it or hits Escape.',
                where: 'component',
            },
            {
                route: '/behaviors/copy',
                title: '`copy`',
                description:
                    'Copy text, rich text or an image to the clipboard when an element is clicked, and mark the element while the copy shows.',
                where: 'component',
            },
            {
                route: '/behaviors/hotkeys',
                title: '`hotkeys`',
                description:
                    'Map key presses to commands with one `keydown` listener that stands aside while the visitor types.',
                where: 'browser',
            },
            {
                route: '/behaviors/is-editable-target',
                title: '`isEditableTarget`',
                description:
                    'Check whether a key event landed in a field the visitor types into, before a listener of your own acts on it.',
                where: 'browser',
            },
            {
                route: '/behaviors/scroll-edges',
                title: '`scrollEdges`',
                description:
                    'Fade or shadow the edges of a scrolling list from CSS while there is more to scroll to, in either direction.',
                where: 'component',
            },
            {
                route: '/behaviors/element-size',
                title: '`elementSize`',
                description:
                    "Bind an element's width and height, in the box ResizeObserver names, to values a template reads.",
                where: 'component',
            },
            {
                route: '/behaviors/element-visible',
                title: '`elementVisible`',
                description:
                    'Bind whether an element is in view, as IntersectionObserver measures it, to a value a template reads.',
                where: 'component',
            },
            {
                route: '/behaviors/element-rect',
                title: '`elementRect`',
                description:
                    "Bind an element's rectangle in the viewport to values a template reads, read at most once a frame.",
                where: 'component',
            },
        ],
    },
    {
        group: 'Helpers',
        description:
            'Plain functions over data: formatting, sorting, markdown, wall-clock times, key labels and JSON Schema validation.',
        form: 'reference',
        pages: [
            {
                route: '/helpers/format',
                title: '`format`',
                description:
                    'Write money, percents, counts, lists, dates and durations the same on server and browser, with a dash for missing values.',
                where: 'anywhere',
            },
            {
                route: '/helpers/highlight',
                title: '`highlight`',
                description:
                    'Mark where a search is in a text, as runs you render, each match carrying a part to style.',
                where: 'anywhere',
            },
            {
                route: '/helpers/shrink-image',
                title: '`shrinkImage`',
                description:
                    'Make a picture small enough to send, in pixels and in bytes, with the same call on the server and in the browser.',
                where: 'anywhere',
            },
            {
                route: '/helpers/download',
                title: '`download`',
                description:
                    'Save text or bytes made in the page as a file under a name you choose.',
                where: 'browser',
            },
            {
                route: '/helpers/sort-by',
                title: '`sortBy`',
                description:
                    'Sort a list by a value of each item: numbers as numbers, dates by time, text in one locale on both sides, and blanks last.',
                where: 'anywhere',
            },
            {
                route: '/helpers/markdown',
                title: '`markdown`',
                description:
                    'Turn markdown into HTML safe to hand `raw`, with its HTML escaped and unsafe links reduced to text.',
                where: 'anywhere',
            },
            {
                route: '/helpers/instant-at',
                title: '`instantAt`',
                description:
                    'Turn a day and a time picked into the moment they name in a zone, the one to keep.',
                where: 'anywhere',
            },
            {
                route: '/helpers/key-label',
                title: '`keyLabel`',
                description:
                    "Write a shortcut binding as the visitor's platform shows it, ⌘ on a Mac and Ctrl elsewhere.",
                where: 'anywhere',
            },
            {
                route: '/helpers/deep-equal',
                title: '`deepEqual`',
                description:
                    'Compare arrays and plain objects by contents rather than reference, so an equal reload or write wakes nobody.',
                where: 'anywhere',
            },
            {
                route: '/helpers/validate-json',
                title: '`validateJson`',
                description:
                    'Check a value against a JSON Schema document, and read what was wrong keyed by the path to it.',
                where: 'anywhere',
            },
            {
                route: '/helpers/json-schema',
                title: '`jsonSchema`',
                description:
                    "Turn a JSON Schema document into a `Schema` that gates a handler's args and is published as written.",
                where: 'anywhere',
            },
        ],
    },
    {
        group: 'Handlers',
        description:
            'A handler file is a server function a page calls by name, with its type the same on both sides, and the same handler is an OpenAPI operation, an MCP tool and a CLI command.',
        form: 'exchange',
        pages: [
            {
                route: '/handlers',
                title: 'One handler, every surface',
                nav: 'Handler surfaces',
                description:
                    "Write a read once and call it from a page, over HTTP, from an OpenAPI client and from an assistant's tools.",
                where: 'server',
                guide: true,
            },
            {
                route: '/handlers/get',
                title: '`GET`',
                description:
                    'Declare a read in a handler file and call it from a page as a reactive value, a stream or a link.',
                where: 'server',
            },
            {
                route: '/handlers/post',
                title: '`POST`, `PUT`, `PATCH` and `DELETE`',
                nav: '`POST` and friends',
                description:
                    'Declare a write with `POST`, `PUT`, `PATCH` or `DELETE`, and refresh what it changed once it answers.',
                where: 'server',
            },
            {
                route: '/handlers/mount-paths',
                title: 'Mount paths',
                description:
                    "Find the address a handler answers at from its file's path, its `[param]` segments and its `<script server>`.",
                where: 'server',
            },
            {
                route: '/handlers/headers',
                title: 'Headers abide generates',
                nav: 'Headers',
                description:
                    'See the headers every answer carries without you writing them, and replace a default from a handler.',
                where: 'server',
            },
            {
                route: '/handlers/clients',
                title: '`clients`',
                description:
                    'Choose which surfaces a handler is on: the page, OpenAPI, MCP and the command line.',
                where: 'server',
            },
            {
                route: '/handlers/openapi',
                title: 'OpenAPI',
                description:
                    'Read the OpenAPI 3.1 document abide writes from your handlers, served or printed beside the code.',
                where: 'server',
            },
            {
                route: '/handlers/mcp',
                title: 'MCP',
                description:
                    'Offer your handlers as the tools of an MCP server a model calls as the person asking.',
                where: 'server',
            },
        ],
    },
    {
        group: 'Middleware and guards',
        description:
            'Rungs run around the requests a route answers: who is signed in, the role they hold, the identities a server trusts, and what a page may write and load.',
        form: 'exchange',
        pages: [
            {
                route: '/middleware',
                title: 'Guarding a section of the app',
                nav: 'Guarding the app',
                description:
                    'Stack rungs around a directory, a handler or the whole app, in the order they run, so one rule guards every page and every surface below it.',
                where: 'server',
                guide: true,
            },
            {
                route: '/middleware/middleware',
                title: '`middleware`',
                description:
                    'Run code around every request under a route, to guard a section, gate pages or answer before routing.',
                where: 'server',
            },
            {
                route: '/middleware/signed-in',
                title: '`signedIn`',
                description:
                    'Refuse a handler to anyone not signed in, answering `SignedOut` at 401 before the body runs.',
                where: 'server',
            },
            {
                route: '/middleware/authorize',
                title: '`authorize`',
                description:
                    'Admit only signed-in callers whose claims hold the ones you name, or that a test of the principal passes, refusing the rest `Forbidden` at 403.',
                where: 'server',
            },
            {
                route: '/middleware/trusted-identity',
                title: '`trustedIdentity`',
                description:
                    'Sign in the caller a single sign-on proxy in front of the app names in a header, believed from that proxy alone.',
                where: 'server',
            },
            {
                route: '/middleware/read-only',
                title: '`readOnly`',
                description:
                    'Refuse every write below a route or to a handler, keeping open the handlers you allow.',
                where: 'server',
            },
            {
                route: '/middleware/csp',
                title: '`csp`',
                description:
                    "Admit only the app's own scripts and styles with a content security policy, and read the nonce for an inline script.",
                where: 'anywhere',
            },
        ],
    },
    {
        group: 'Ambients',
        description:
            'What is true of the work being done — the request, the response, the cookies, the person, the signal that says stop — read without passing it in.',
        form: 'exchange',
        pages: [
            {
                route: '/ambients/request',
                title: '`request`',
                description:
                    "Read the request being answered, its headers, signal and caller's address, from anywhere in the code answering it.",
                where: 'server',
            },
            {
                route: '/ambients/response',
                title: '`response`',
                description:
                    'Set the status and headers of the answer, or fix it as a page, JSON, a redirect, or a stream.',
                where: 'server',
            },
            {
                route: '/ambients/cookies',
                title: '`cookies`',
                description:
                    'Read and write cookies by name on both sides, so the server paints what the browser chose.',
                where: 'anywhere',
            },
            {
                route: '/ambients/principal',
                title: '`principal`',
                description:
                    'Sign a caller in and out, read who they are, and decide in a handler what they see.',
                where: 'anywhere',
            },
            {
                route: '/ambients/config',
                title: '`config`',
                description:
                    'Read typed settings, defaulted by `onConfig` and overridden by the environment, validated once at start.',
                where: 'server',
            },
            {
                route: '/ambients/server',
                title: '`server`',
                description:
                    'Reach the listening Bun server for what abide does not carry, such as requests in flight.',
                where: 'server',
            },
            {
                route: '/ambients/reachable',
                title: '`reachable`',
                description:
                    'Ask whether another host answers, so a handler can refuse at once while it is down.',
                where: 'server',
            },
            {
                route: '/ambients/is-server',
                title: '`isServer`',
                description:
                    "Tell whether code is running in a server's request or render or in the browser, to guard browser-only APIs.",
                where: 'anywhere',
            },
            {
                route: '/ambients/abort-signal',
                title: '`abortSignal`',
                description:
                    "Read the signal that says stop, so a memo's superseded run, a caller who hung up or a stopping app ends its fetch early.",
                where: 'anywhere',
            },
        ],
    },
    {
        group: 'Browser context',
        description:
            'What is true of the browser a page stands in: whether it is online, what the screen matches, and the calls it has not delivered yet.',
        form: 'reference',
        pages: [
            {
                route: '/browser/online',
                title: '`online`',
                description:
                    'Tell the reader the browser has lost its network, and catch up when it returns.',
                where: 'browser',
            },
            {
                route: '/browser/media',
                title: '`media`',
                description:
                    'Follow a CSS media query, such as a width or reduced motion, from script as a value a page reads.',
                where: 'browser',
            },
            {
                route: '/browser/outbox',
                title: '`outbox`',
                description:
                    'Queue writes made offline, send them in order once the server answers, and retry or drop the refused ones.',
                where: 'browser',
            },
        ],
    },
    {
        group: 'App and lifecycle',
        description:
            'The app object, its environment, and the functions it registers to run around its boot, its errors, its config and its people.',
        form: 'reference',
        pages: [
            {
                route: '/app',
                title: 'An app from start to stop',
                nav: 'App lifecycle',
                description:
                    'Follow the CRM from the process starting, through a request it answers, refuses or fails, to the process stopping, and see which hook runs at each point.',
                where: 'server',
                guide: true,
            },
            {
                route: '/app/create-app',
                title: '`createApp`',
                description:
                    'Start the app in-process with no port, and drive it through `fetch` and `run` from a test or a host.',
                where: 'server',
            },
            {
                route: '/app/environment',
                title: 'Environment variables',
                nav: 'Environment',
                description:
                    'Set the port, public URL, secrets, logging, offline mode and telemetry export with environment variables.',
                where: 'server',
            },
            {
                route: '/app/on-start',
                title: '`onStart`',
                description:
                    "Run work around the app's boot, such as connecting a pool or migrating, before the first request is answered.",
                where: 'server',
            },
            {
                route: '/app/on-stop',
                title: '`onStop`',
                description:
                    'Close what the app opened once in-flight requests drain, on a signal, a quit or `App.stop`.',
                where: 'server',
            },
            {
                route: '/app/on-error',
                title: '`onError`',
                description:
                    'Send an unexpected error to a tracker, on the server under a route or in the browser under a component.',
                where: 'anywhere',
            },
            {
                route: '/app/on-refusal',
                title: '`onRefusal`',
                description:
                    "Hear every refusal a browser call gets while a component stands, with the call's method, URL and trace.",
                where: 'browser',
            },
            {
                route: '/app/on-config',
                title: '`onConfig`',
                description:
                    'Give config settings defaults a deployment overrides, and check the whole document with a schema before the app starts.',
                where: 'server',
            },
            {
                route: '/app/on-health',
                title: '`onHealth`',
                description:
                    "Add the app's own fields, such as a database's state, to the health check at `/__abide/health`.",
                where: 'server',
            },
            {
                route: '/app/on-principal',
                title: '`onPrincipal`',
                description:
                    'Turn the claims in a signed-in cookie into the member a page and a handler read.',
                where: 'server',
            },
            {
                route: '/app/on-pairing',
                title: '`onPairing`',
                description:
                    "Set, per person, the Claude Code arguments a pairing's command and install carry after `--`.",
                where: 'server',
            },
            {
                route: '/app/on-report',
                title: '`onReport`',
                description:
                    'Send each problem report a person files to your tracker, refusing the send when the tracker fails.',
                where: 'server',
            },
            {
                route: '/app/on-launcher',
                title: '`onLauncher`',
                description:
                    "Set the native app's window, launcher forms, menu bar extra and update feed.",
                where: 'server',
            },
        ],
    },
    {
        group: 'Data and I/O',
        description:
            'The database, background jobs, and fetches of other services read as their content type says.',
        form: 'reference',
        pages: [
            {
                route: '/data',
                title: "Keeping the CRM's records",
                nav: 'Records and I/O',
                description:
                    "Keep records in a database behind a handler, work on them on a schedule, and read other services, with each step shown on the CRM's own data.",
                where: 'server',
                guide: true,
            },
            {
                route: '/data/database',
                title: '`database`',
                description:
                    "Open the app's SQLite file where the deployment keeps its data, and run each migration once, in order.",
                where: 'server',
            },
            {
                route: '/data/table',
                title: '`table`',
                description:
                    'Read every change committed to a SQLite table as a stream, refresh what is tagged with it, and upsert rows in batches.',
                where: 'server',
            },
            {
                route: '/data/job',
                title: '`job`',
                description:
                    'Run work on the server on a schedule, one run at a time, with a status every page can read.',
                where: 'server',
            },
            {
                route: '/data/fetch-data',
                title: '`fetchData`',
                description:
                    'Ask another service with a deadline, retries and an optional cache, read the answer as its type says, and get a refusal rather than a throw when it gives up.',
                where: 'server',
            },
            {
                route: '/data/handle',
                title: '`handle`',
                description:
                    'Read a response you fetched yourself as its type says: JSON, a stream of chunks, text or bytes.',
                where: 'anywhere',
            },
        ],
    },
    {
        group: 'Assistant',
        description:
            'A conversation with a model that calls your handlers as tools, as the same person who asked.',
        form: 'reference',
        pages: [
            {
                route: '/ai',
                title: 'Putting an assistant in the app',
                nav: 'Assistant setup',
                description:
                    "Put a model behind the CRM's handlers as tools, choose its provider, pair it with a person's own Claude Code and keep its transcript.",
                where: 'server',
                guide: true,
            },
            {
                route: '/ai/assistant',
                title: '`assistant`',
                description:
                    'Stream a conversation with a model whose tools are your handlers, from a handler you write.',
                where: 'server',
            },
            {
                route: '/ai/results-of',
                title: '`resultsOf`',
                description:
                    "Read what a conversation's calls to one handler answered, typed as that handler's value.",
                where: 'anywhere',
            },
            {
                route: '/ai/user-message',
                title: '`userMessage`',
                description:
                    "Turn a question and the files attached to it — photos, PDFs, text — into the person's turn, as the model reads it.",
                where: 'anywhere',
            },
            {
                route: '/ai/provider',
                title: '`provider`',
                description:
                    "Run the conversation on the Claude API, or on the visitor's own Claude Code through the bridge.",
                where: 'server',
            },
            {
                route: '/ai/pairing',
                title: '`pairing`',
                description:
                    "Pair this browser with the visitor's Claude Code with a click, and follow the pairing's status.",
                where: 'browser',
            },
            {
                route: '/ai/transcript',
                title: '`transcript`',
                description:
                    'Fold a streamed answer into the turns a chat shows, and send them back as messages.',
                where: 'component',
            },
        ],
    },
    {
        group: 'The native app',
        description:
            'The desktop app an abide app compiles to: its window, its menu bar and its updates.',
        form: 'reference',
        pages: [
            {
                route: '/native-app/native',
                title: '`native`',
                description:
                    "Tell the native app's window from a browser, and drag the window by a header drawn under its controls.",
                where: 'anywhere',
            },
            {
                route: '/native-app/pending-update',
                title: '`pendingUpdate`',
                description:
                    'Show the update the native window has staged, and restart into it.',
                where: 'browser',
            },
            {
                route: '/native-app/on-menu',
                title: '`onMenu`',
                description:
                    "Add menus to the native app's menu bar while a layout or page stands, following the values they read.",
                where: 'component',
            },
            {
                route: '/native-app/menu-item',
                title: '`menuItem`',
                description:
                    'Make a menu bar entry that runs your function when picked, or one the platform performs by role.',
                where: 'component',
            },
        ],
    },
    {
        group: 'Operating',
        description:
            'Logs, problem reports, traces and health checks for an app that is running.',
        form: 'exchange',
        pages: [
            {
                route: '/operating/log',
                title: '`log`',
                description:
                    'Write leveled lines under a named namespace, turned on with `DEBUG` on the server and in the browser.',
                where: 'anywhere',
            },
            {
                route: '/operating/report',
                title: '`report`',
                description:
                    "Start a problem report from a failed call's trace, let the person read every word, and send it to `onReport`.",
                where: 'anywhere',
            },
            {
                route: '/operating/trace',
                title: '`trace`',
                description:
                    'Follow one request through every handler, log line and outbound call with one trace id, and time its spans.',
                where: 'server',
            },
            {
                route: '/operating/health',
                title: '`health`',
                description:
                    "Read the app's health report, the same one a load balancer polls, with your own fields beside the baseline.",
                where: 'anywhere',
            },
        ],
    },
    {
        group: 'Testing and measurement',
        description:
            'Mount a component in `bun test`, wait for what it loads, and count, time and gate what it does with the harness abide is measured with.',
        form: 'reference',
        pages: [
            {
                route: '/testing/mount',
                title: '`mount`',
                description:
                    'Render and hydrate a component in `bun test`, then click it and read what it rendered.',
                where: 'test',
            },
            {
                route: '/testing/settled',
                title: '`settled`',
                description:
                    'Wait in a test until every load and effect a click started has finished, instead of sleeping.',
                where: 'test',
            },
            {
                route: '/testing/flush-sync',
                title: '`flushSync`',
                description:
                    'Run every effect a write woke right now, so a test or a layout read sees the updated page.',
                where: 'anywhere',
            },
            {
                route: '/harness/measure/measure',
                title: '`measure`',
                description:
                    'Count what an op did to the DOM, rows moved, nodes created, text and class writes, and what your own code published while it ran.',
                registry: '`measure` — `@abide/harness/measure`',
                where: 'test',
            },
            {
                route: '/harness/measure/published-by',
                title: '`publishedBy`',
                description:
                    "Read one source's published counters off a `Work`, or `null` when nothing was published.",
                registry: '`publishedBy` — `@abide/harness/measure`',
                where: 'test',
            },
            {
                route: '/harness/measure/published-work-key',
                title: '`PUBLISHED_WORK_KEY`',
                description:
                    'Publish your own counters under this global so `measure` zeroes them per case and copies them into its result.',
                registry: '`PUBLISHED_WORK_KEY` — `@abide/harness/measure`',
                where: 'test',
            },
            {
                route: '/harness/measure/time',
                title: '`time`',
                description:
                    'Time several arms of an op in one interleaved batch, refused while counting and on an emulated DOM.',
                registry: '`time` — `@abide/harness/measure`',
                where: 'test',
            },
            {
                route: '/harness/measure/patch-set',
                title: '`patchSet`',
                description:
                    'List every DOM member the measure lane patches, by `Interface.member`, so you know what a count covers.',
                registry: '`patchSet` — `@abide/harness/measure`',
                where: 'test',
            },
            {
                route: '/harness/preload',
                title: '`@abide/harness/preload`',
                nav: '`preload`',
                description:
                    "Give every `bun test` process a DOM with the measure lane's counters installed, while `fetch` and the wire stay bun's own.",
                where: 'test',
            },
            {
                route: '/harness/engine/trace-op',
                title: '`traceOp`',
                description:
                    'Trace one op in a Chromium page from Playwright, and read its style, layout, paint and forced-layout counts and its user timing.',
                registry: '`traceOp` — `@abide/harness/engine`',
                where: 'test',
            },
            {
                route: '/harness/engine/shares',
                title: '`shares`',
                description:
                    'Find what fraction of a whole op one measured layer took, and whether a person would see the saving.',
                registry: '`shares` — `@abide/harness/engine`',
                where: 'test',
            },
            {
                route: '/harness/engine/measures-named',
                title: '`measuresNamed`',
                description:
                    'List every user-timing measure in a trace with one name, in trace order.',
                registry: '`measuresNamed` — `@abide/harness/engine`',
                where: 'test',
            },
            {
                route: '/harness/engine/duration-of',
                title: '`durationOf`',
                description:
                    'Sum the nanoseconds of every measure with one name in a trace.',
                registry: '`durationOf` — `@abide/harness/engine`',
                where: 'test',
            },
            {
                route: '/harness/server/bytes',
                title: '`bytes`',
                description:
                    "Measure what a response, string or buffer sends, or estimate an object's memory, to compare a render across sizes.",
                registry: '`bytes` — `@abide/harness/server`',
                where: 'test',
            },
            {
                route: '/harness/server/ticks',
                title: '`ticks`',
                description:
                    "Count the microtask turns a call's result takes to settle.",
                registry: '`ticks` — `@abide/harness/server`',
                where: 'test',
            },
            {
                route: '/harness/server/retained',
                title: '`retained`',
                description:
                    'Diff the live objects a call leaves behind, by engine type, in a process with no DOM.',
                registry: '`retained` — `@abide/harness/server`',
                where: 'test',
            },
            {
                route: '/harness/server/retained-per-run',
                title: '`retainedPerRun`',
                description:
                    'Find what each run of a call keeps reachable, as a batch mean, and whether that grows across the batch.',
                registry: '`retainedPerRun` — `@abide/harness/server`',
                where: 'test',
            },
            {
                route: '/harness/server/closures',
                title: '`closures`',
                description:
                    'Count the functions and scopes a call leaves behind, as the pair the engine reports a closure as.',
                registry: '`closures` — `@abide/harness/server`',
                where: 'test',
            },
            {
                route: '/harness/report/batch',
                title: '`batch`',
                description:
                    'Time each arm of an op in interleaved batches sized to the clock, with an A/A floor that says how much difference is noise.',
                registry: '`batch` — `@abide/harness/report`',
                where: 'test',
            },
            {
                route: '/harness/report/ratio',
                title: '`ratio`',
                description:
                    "Divide one arm's time by another's, getting a number only when the difference clears the floor and a frame.",
                registry: '`ratio` — `@abide/harness/report`',
                where: 'test',
            },
            {
                route: '/harness/report/claim-of',
                title: '`claimOf`',
                description:
                    'Print a `ratio` verdict as the one line a bench report shows: a ratio, or why there is none.',
                registry: '`claimOf` — `@abide/harness/report`',
                where: 'test',
            },
            {
                route: '/harness/report/emulated-dom',
                title: '`emulatedDom`',
                description:
                    'Tell `batch` whether a timed op touched an emulated DOM, so a happy-dom duration is refused rather than quoted.',
                registry: '`emulatedDom` — `@abide/harness/report`',
                where: 'test',
            },
            {
                route: '/harness/report/thresholds',
                title: '`THRESHOLDS`',
                description:
                    'Judge a cost against one frame and the interaction budget, the two lines where a wait becomes visible.',
                registry: '`THRESHOLDS` — `@abide/harness/report`',
                where: 'test',
            },
            {
                route: '/harness/gate/gate',
                title: '`gate`',
                description:
                    'Write a test that carries its own revert, and prove it fails reporting the number the old version did.',
                registry: '`gate` — `@abide/harness/gate`',
                where: 'test',
            },
            {
                route: '/harness/gate/spawned',
                title: '`spawned`',
                description:
                    'Run a child process from a test, awaited, killed at a deadline that fails the test naming the command.',
                registry: '`spawned` — `@abide/harness/gate`',
                where: 'test',
            },
            {
                route: '/harness/gate/at-most',
                title: '`atMost`',
                description:
                    'Hold a measured op to a ceiling per counter, failing from your line with every field that went over.',
                registry: '`atMost` — `@abide/harness/gate`',
                where: 'test',
            },
            {
                route: '/harness/gate/in-a-fresh-process',
                title: '`inAFreshProcess`',
                description:
                    'Run source in a child bun with no DOM preloaded and no worker mark, for a check the test process would skew.',
                registry: '`inAFreshProcess` — `@abide/harness/gate`',
                where: 'test',
            },
            {
                route: '/harness/rows/in-scope',
                title: '`inScope`',
                description:
                    'Select runner rows by `--scope`: all of them, one section, or one item.',
                registry: '`inScope` — `@abide/harness/rows`',
                where: 'test',
            },
            {
                route: '/harness/rows/matches-filter',
                title: '`matchesFilter`',
                description:
                    'Filter rows by typed text, matched case-insensitively against section and name, the same way the runner selects.',
                registry: '`matchesFilter` — `@abide/harness/rows`',
                where: 'test',
            },
            {
                route: '/harness/runner/rows-command',
                title: '`rowsCommand`',
                description:
                    'Turn a list of items into a runner command that lists its catalog or streams one JSON row per result.',
                registry: '`rowsCommand` — `@abide/harness/runner`',
                where: 'test',
            },
            {
                route: '/harness/runner/test-rows',
                title: '`testRows`',
                description:
                    "Run an app's test files one process each, printing a `TestRow` per file as it finishes.",
                registry: '`testRows` — `@abide/harness/runner`',
                where: 'test',
            },
            {
                route: '/harness/runner/run-benches',
                title: '`runBenches`',
                description:
                    "Run every `*.bench.ts` under an app's `src`, with each arm's time per operation and every ceiling it broke.",
                registry: '`runBenches` — `@abide/harness/runner`',
                where: 'test',
            },
            {
                route: '/harness/abide/measure',
                title: '`measure`',
                nav: '`measure` for abide',
                description:
                    "Count the DOM work an op did in a test, with abide's wakes, binding runs and descents beside it.",
                registry: '`measure` — `@abide/harness/abide`',
                where: 'test',
            },
            {
                route: '/harness/abide/preload',
                title: '`@abide/harness/abide/preload`',
                nav: '`abide/preload`',
                description:
                    'Add one `bunfig.toml` line so tests can import `.abide` files, mount them and measure their work.',
                where: 'test',
            },
        ],
    },
    {
        group: 'CLI',
        description:
            'The `abide` command and the bridge that connects Claude Code to a site.',
        form: 'transcript',
        pages: [
            {
                route: '/cli/commands',
                title: 'The `abide` command',
                nav: 'Commands',
                description:
                    'Scaffold, develop, check, build, serve, call, watch, compile and upgrade an abide app from the terminal.',
                registry: 'Commands',
                where: 'terminal',
            },
            {
                route: '/cli/bridge',
                title: '`abide-bridge`',
                description:
                    "Pair your own Claude Code with an abide site's assistant, register its pairing links, and make allowed sites ask again.",
                where: 'terminal',
            },
        ],
    },
]

/** Every group of the site, each page's `nav`, `registry` and `subgroup` filled in. */
export const SITE: readonly SiteGroup[] = WRITTEN.map((written) => ({
    ...written,
    pages: written.pages.map((page) => ({
        ...page,
        nav: page.nav ?? page.title,
        registry: page.guide ? '' : (page.registry ?? page.title),
        subgroup: page.subgroup,
        guide: page.guide === true,
    })),
}))
