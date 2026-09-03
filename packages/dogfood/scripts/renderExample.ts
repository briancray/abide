// An EXAMPLE is a DIRECTORY, not a fence: real files that the build can one day
// compile, serve, test and bench, per docs/SPEC.md ("Documentation"). This module
// reads one and renders what a page embeds with `{% example name %}`: the panelled component
// for the site, and the same files as fences for the markdown bundle.
//
// SCAFFOLDING, with a seam that is meant to survive: `result`, `wire` and
// `bench` are read from the example DIRECTORY rather than written into this file, so
// when the compiler and the harness land they replace those artifacts and nothing here
// changes. Today they are checked-in static content.

import { displayPath, escapeHtml, highlight, renderInline, sideOf } from './renderMarkdown.ts'

const EXAMPLES_DIR = new URL('../examples/', import.meta.url)
const APP_STYLESHEET = new URL('../src/ui/app.css', import.meta.url)
const FONTS =
    'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;600&family=Space+Grotesk:wght@600;700&display=swap'

type ExampleFile = { path: string; source: string }

// Runs INSIDE the result frame, which is the only place it can run: `mirror` follows an
// input as it is typed and a round trip to the parent per keystroke would swap the whole
// document out from under the caret. A TRANSITION is the opposite — it replaces the
// document — so that one is posted up and the parent decides.
//
// The transforms are a FIXED SET, and deliberately small: they stand in for the code the
// page is teaching until the compiler can run it, so a demo can only mock what some
// example's source actually says. Anything needing a sixth is asking for bespoke
// per-example script, which is the thing this exists instead of.
const DRIVER = `<script>
const machine = JSON.parse(document.querySelector('[data-machine]').textContent)
const TRANSFORMS = {
  trim: (v) => v.trim(),
  lowercase: (v) => v.toLowerCase(),
  uppercase: (v) => v.toUpperCase(),
  slug: (v) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  count: (v) => String(v.length),
}
function mirror() {
  for (const rule of machine.mirror) {
    const from = document.querySelector(rule.from)
    const to = document.querySelector(rule.to)
    if (!from || !to) continue
    const value = from.type === 'checkbox' ? String(from.checked) : from.value
    to.textContent = rule.transform ? TRANSFORMS[rule.transform](value) : value
  }
}
function fire(kind, event) {
  for (const key of Object.keys(machine.on)) {
    const space = key.indexOf(' ')
    if (key.slice(0, space) !== kind) continue
    if (!event.target.closest(key.slice(space + 1))) continue
    event.preventDefault()
    parent.postMessage({ abide: machine.on[key] }, '*')
    return
  }
}
// The frame is as tall as its content, and only the frame can know that. It reports
// rather than the parent measuring, because the parent has no origin to read across.
function measure() {
  parent.postMessage({ abideHeight: document.documentElement.scrollHeight }, '*')
}
new ResizeObserver(measure).observe(document.documentElement)
// A WHEEL OVER THE FRAME IS THE PAGE'S, not the example's. A cross-document scroll does
// not chain to the parent, so a frame sized to its content — which is every one of them —
// swallows the gesture and the reader stops dead halfway down the page. Forwarded only
// when this document genuinely has nowhere to scroll, so an example that grows a scroller
// of its own keeps it.
addEventListener('wheel', (event) => {
  const root = document.documentElement
  if (root.scrollHeight > root.clientHeight) return
  event.preventDefault()
  parent.postMessage({ abideWheel: { x: event.deltaX, y: event.deltaY } }, '*')
}, { passive: false })
addEventListener('input', mirror)
addEventListener('input', (event) => fire('input', event))
addEventListener('change', (event) => fire('change', event))
addEventListener('click', (event) => fire('click', event))
addEventListener('submit', (event) => fire('submit', event))
mirror()
measure()
</script>`

// WHICH FILE A READER OPENS FIRST is the one the problem is solved in. That is the
// `.abide` file for almost every problem — the page is where an author starts, and
// the handler is what they reach back for — so the order is DERIVED from each file's
// seam rather than from how the manifest happens to list them. `about: 'server'` is
// the one exception, for an example whose problem IS a server problem (validating a
// body, authorising a call), where the handler is the thing being read.
const SEAM_ORDER = {
    ui: ['abide', 'browser', 'server'],
    server: ['server', 'abide', 'browser'],
} as const

function orderedFiles(paths: string[], about: 'ui' | 'server'): string[] {
    const seams = SEAM_ORDER[about]
    // Stable, so two files on the same seam keep the order the manifest gave them.
    return [...paths].sort((a, b) => seams.indexOf(sideOf(a)) - seams.indexOf(sideOf(b)))
}

// Only `title`, `summary`, `files`, `result` and `route` are owed. A panel an example
// has no artifact for is NOT RENDERED — a Wire tab on an example that makes no request
// would be a claim about work that never happened, so Result is a lone pane there.
export type Manifest = {
    title: string
    summary: string
    files: string[]
    route: string
    // A settled snapshot cannot show `pending()`, so a result is never one document.
    // It is a MACHINE: `hold` waits and then goes to `then`, `on` goes somewhere on
    // something the reader did, and `mirror` is the one thing that happens WITHOUT a
    // state change — text following an input as it is typed. A film strip is the case
    // where only `hold` is used, which is why there is no second shape for it.
    //
    // `after` NAMES its target rather than meaning the next entry, because a reload
    // returns to the state it reloaded — array order could express a strip and could
    // not express that, and an implicit rule that only works for the simple case is
    // the one that breaks silently on the first case it does not.
    states: {
        id: string
        file: string
        hold?: number
        after?: string
        on?: Record<string, string>
        mirror?: { from: string; to: string; transform?: string }[]
    }[]
    about?: 'ui' | 'server'
    // What the build emits, and the hand-written arm every bench ratio is against. Neither is
    // a panel: both SHIP, in the download and in the line counts, and a reader who wants the
    // emitted code wants it in a file rather than beside the source it came from.
    compiled?: string[]
    vanilla?: string[]
    // Test RESULTS, not test source: what a reader wants from this panel is whether
    // the example holds, and the spec itself is in the download.
    tests?: { note?: string; rows: { name: string; result: string }[] }
    // A REFUSAL is the one artifact whose source cannot live in `files/` — that source is
    // wrong on purpose, and an example the build rejects is not an example. It gets its own
    // folder, so what a reader downloads still runs.
    wire?: {
        request: string
        requestHeaders: Record<string, string>
        status: string
        responseHeaders: Record<string, string>
        body: string
    }[]
    bench?: {
        note: string
        rows: { metric: string; abide: string; vanilla: string; ratio: string }[]
    }
}

// BOTH WAYS A MACHINE CAN BE WRONG ARE SILENT. A duplicate id makes one state
// unreachable and the other arbitrary; a transition naming no state dead-ends on the
// click that takes it. Neither shows in the rendered output, because the output of the
// state you never reach is not rendered at all — so they are refused at build.
export function checkMachine(name: string, states: Manifest['states']): void {
    const ids = new Set<string>()
    for (const state of states) {
        if (ids.has(state.id)) throw new Error(`example ${name}: two states share id ${state.id}`)
        ids.add(state.id)
    }
    for (const state of states) {
        for (const [event, target] of Object.entries(state.on ?? {})) {
            if (ids.has(target)) continue
            throw new Error(`example ${name}: ${state.id} on "${event}" names no state ${target}`)
        }
        if (state.hold && !ids.has(state.after ?? ''))
            throw new Error(`example ${name}: ${state.id} holds but names no state to go to`)
    }
}

// Every panel that holds files reads the same way, so they share one loader and one
// renderer rather than four that drift.
async function readGroup(name: string, folder: string, paths: string[]): Promise<ExampleFile[]> {
    const group: ExampleFile[] = []
    for (const path of paths) {
        const file = Bun.file(new URL(`${name}/${folder}/${path}`, EXAMPLES_DIR))
        if (!(await file.exists())) throw new Error(`example ${name}: ${folder}/${path} is missing`)
        group.push({ path, source: await file.text() })
    }
    return group
}

function renderFileGroup(files: ExampleFile[], key: string): string {
    let tabs = ''
    let bodies = ''
    for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        if (!file) continue
        const selected = index === 0
        tabs += `<button role="tab" aria-selected="${selected}" data-side="${sideOf(file.path)}" data-file="${key}:${index}">${escapeHtml(displayPath(file.path))}</button>`
        bodies += `<pre data-file="${key}:${index}"${selected ? '' : ' hidden'}><code>${highlight(file.source.trimEnd())}</code></pre>`
    }
    return `<div class="ex-files" role="tablist">${tabs}</div>${bodies}`
}

function renderHeaders(headers: Record<string, string>): string {
    let rows = ''
    for (const [name, value] of Object.entries(headers)) {
        rows += `<tr><td><code>${escapeHtml(name)}</code></td><td><code>${escapeHtml(value)}</code></td></tr>`
    }
    return `<table class="ex-headers"><tbody>${rows}</tbody></table>`
}

// A TAB IS THE HANDLER AND ITS ARGUMENTS, which is the whole of what tells two calls apart.
// The mount prefix is the same on every one, so it is furniture in a label: three tabs reading
// `/__abide/rpc/…` differ in their last eight characters and a reader has to find them.
function wireLabel(request: string): string {
    const [method = 'GET', address = ''] = request.split(' ')
    const call = address.slice(address.lastIndexOf('/') + 1)
    return method === 'GET' ? call : `${method} ${call}`
}

// Stacked, three exchanges is a page to scroll for the one you want. Tabbed, it is the same
// device Files already uses — and the tablist markup is that one, so the panel script that
// switches files switches these without knowing they are not files.
function renderWire(entries: NonNullable<Manifest['wire']>): string {
    let tabs = ''
    let bodies = ''
    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]
        if (!entry) continue
        const selected = index === 0
        tabs += `<button role="tab" aria-selected="${selected}" data-side="server" data-file="wire:${index}">${escapeHtml(wireLabel(entry.request))}</button>`
        bodies += `<div data-file="wire:${index}"${selected ? '' : ' hidden'}>
<p class="ex-line ex-request"><code>${escapeHtml(entry.request)}</code></p>
${renderHeaders(entry.requestHeaders)}
<p class="ex-line ex-status"><code>${escapeHtml(entry.status)}</code></p>
${renderHeaders(entry.responseHeaders)}
<pre><code>${highlight(entry.body)}</code></pre>
</div>`
    }
    return `<div class="ex-files" role="tablist">${tabs}</div>${bodies}`
}

// Wire used to be a second tab beside Rendered, on the reasoning that both answer "what
// came back". They do — but only one of them is the THING, and burying the running page
// behind a tab made an example something to read. The render is now always on screen and
// Wire is a panel of its own beside Files.
function renderTests(tests: NonNullable<Manifest['tests']>): string {
    let rows = ''
    for (const row of tests.rows) {
        // Only `pass` is styled. A non-pass renders muted rather than red, because no
        // example has one yet and a colour nothing uses is a colour nobody maintains.
        rows += `<tr><td>${escapeHtml(row.name)}</td><td class="ex-status ex-result-${escapeHtml(row.result)}">${escapeHtml(row.result)}</td></tr>`
    }
    const note = tests.note ? `<p class="ex-note">${renderInline(tests.note)}</p>` : ''
    return `<table class="ex-tests"><thead><tr><th>Test</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>
${note}`
}

// Every metric a bench carries is LOWER-IS-BETTER — milliseconds, nodes, bytes, lines —
// so the direction is read off the number rather than declared per row. A metric where
// more is better would be the first one that needs the row to say so.
function ratioDirection(ratio: string): string {
    const value = Number.parseFloat(ratio)
    if (!Number.isFinite(value) || value === 1) return ''
    return value < 1 ? ' class="ex-good"' : ' class="ex-bad"'
}

function renderBench(bench: NonNullable<Manifest['bench']>): string {
    let rows = ''
    for (const row of bench.rows) {
        rows += `<tr><td>${escapeHtml(row.metric)}</td><td><code>${escapeHtml(row.abide)}</code></td><td><code>${escapeHtml(row.vanilla)}</code></td><td class="ex-ratio"><code${ratioDirection(row.ratio)}>${escapeHtml(row.ratio)}</code></td></tr>`
    }
    return `<table class="ex-bench"><thead><tr><th>Metric</th><th>abide</th><th>Hand-written</th><th class="ex-ratio">Ratio</th></tr></thead><tbody>${rows}</tbody></table>
<p class="ex-note">${renderInline(bench.note)}</p>`
}

// WHAT THE RESULT FRAME TAKES FROM THE APP STYLESHEET, by the text each rule starts
// with. Lifted rather than restated so an example renders the way an abide page renders
// and the two cannot drift — which is also the failure mode: rename one of these in
// app.css and the frame quietly loses that rule, with the page still rendering. The
// check in `snippet.test.ts` is what makes that loud.
export const FRAME_RULES = [
    ':root',
    '@media (prefers-color-scheme: dark)',
    '\nh1 {',
    '\np {',
    '\na {',
    '\na[aria-current]',
    '\n.switch {',
    '\n.switch a {',
    '\n.switch a:hover',
    '\n.switch a[aria-current]',
    '\ninput, textarea, select {',
    '\ninput:focus-visible',
    '\nbutton {',
    '\nbutton:hover',
    '\nlabel {',
    '\nlabel input, label select',
    '\nlabel input[type=checkbox]',
    '\nlabel:has(> input[type=checkbox])',
    '\n.tip {',
    '\n.tip::before',
    '\n.tip button {',
    '\n.tip button:hover',
    '\n.tip code',
]

function ruleAt(css: string, selector: string): string {
    const at = css.indexOf(selector)
    if (at === -1) return ''
    let depth = 0
    for (let index = at; index < css.length; index += 1) {
        if (css[index] === '{') depth += 1
        else if (css[index] === '}') {
            depth -= 1
            if (depth === 0) return css.slice(at, index + 1)
        }
    }
    return ''
}

// The result renders in an IFRAME so the docs' own stylesheet cannot reach it — a
// rendered heading picking up this page's colour would misreport the output.
//
// What it DOES take from the app stylesheet is the TOKENS, lifted from that file
// rather than restated here, so an example cannot drift into a second design system
// and a palette change reaches it for free. Only the tokens: the site's chrome is a
// sidebar grid, and a page that is not the docs would be wrecked by it.
function renderResult(
    states: (Manifest['states'][number] & { body: string })[],
    route: string,
    appCss: string,
): string {
    // Tokens AND the element defaults, so an example with no `<style>` of its own
    // renders the way an abide page renders. Every rule is lifted from the app
    // stylesheet rather than restated, except `body` — the site's own is a sidebar
    // grid, which is chrome rather than a default.
    const base = FRAME_RULES.map((selector) => ruleAt(appCss, selector)).join('')
    const document = (state: Manifest['states'][number], body: string) =>
        `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="${FONTS}">
<style>${base}
body { margin:0; padding:1.5rem; background:var(--paper); color:var(--ink);
  font:400 15px/1.6 var(--sans); }
</style>${body}
<script type="application/json" data-machine>${JSON.stringify({
    on: state.on ?? {},
    mirror: state.mirror ?? [],
}).replaceAll('<', '\\u003c')}</script>${DRIVER}`

    const frames = states.map((state) => ({
        id: state.id,
        hold: state.hold ?? 0,
        after: state.after ?? '',
        on: state.on ?? {},
        mirror: state.mirror ?? [],
        html: document(state, state.body),
    }))
    // WHERE A MACHINE RESTS is WHERE THE CLOCK STOPS: follow `hold` from the first state
    // and settle on the first one that does not have it. A film strip rests on its last
    // frame, having already finished by the time anyone looks; a driven machine rests on
    // its first, waiting for the reader; and one that loads and THEN waits — a hold into
    // an editable form — rests on the form rather than on whatever a click leads to.
    // Decided here rather than in script, so the frame is right before any JS runs.
    let home = 0
    for (let step = 0; step < frames.length && frames[home]?.hold; step += 1) {
        const next = frames.findIndex((frame) => frame.id === frames[home]?.after)
        if (next === -1) break
        home = next
    }
    // `<` is escaped so a state's own markup cannot close this script element.
    const data = JSON.stringify(frames).replaceAll('<', '\\u003c')

    // One button, back to the first state — but not one word for it. REPLAY is what a
    // clock-driven strip does, and there is nothing to replay on a machine the reader
    // drives: that one is a RESET, and calling it a replay promises a performance that
    // never comes.
    const label = frames.some((frame) => frame.hold) ? 'Replay' : 'Reset'
    const replay =
        frames.length > 1
            ? `<button type="button" class="ex-replay" data-replay>${label}</button>`
            : ''

    // `allow-scripts` WITHOUT `allow-same-origin`: the driver has to run to answer a
    // click, and withholding the origin is what keeps it from reaching this document.
    // The parent hears about a transition by message rather than by reading the frame.
    //
    // `loading="lazy"` was here and did NOTHING, which is worth stating so it does not
    // come back: the attribute defers a FETCH, and a srcdoc frame has no fetch to defer.
    // Measured 2642px below the fold with the attribute set and the frame's own script
    // already run. So a section overview renders every example it carries, at load.
    return `<div class="ex-browser">
<iframe class="ex-result" title="The rendered output of ${escapeHtml(route)}" sandbox="allow-scripts" srcdoc="${escapeHtml(frames[home]?.html ?? '')}"></iframe>${replay}
<script type="application/json" data-states>${data}</script>
</div>`
}

function renderDownload(name: string, root: string): string {
    return `<a class="ex-download" href="${root}examples/${name}.zip" download>Download</a>`
}

export type Example = { name: string; html: string }

export async function readExample(name: string, root: string): Promise<Example> {
    const manifest: Manifest = await Bun.file(new URL(`${name}/example.json`, EXAMPLES_DIR)).json()
    const sourcePaths = orderedFiles(manifest.files, manifest.about ?? 'ui')
    const files = await readGroup(name, 'files', sourcePaths)
    checkMachine(name, manifest.states)
    const states: (Manifest['states'][number] & { body: string })[] = []
    for (const state of manifest.states) {
        const file = Bun.file(new URL(`${name}/${state.file}`, EXAMPLES_DIR))
        if (!(await file.exists())) throw new Error(`example ${name}: ${state.file} is missing`)
        states.push({ ...state, body: await file.text() })
    }
    const appCss = await Bun.file(APP_STYLESHEET).text()

    // THE RENDER IS NOT A PANEL. It is the thing the example IS, so it sits above the
    // tabs and stays there — what the tabs hold is everything you consult ABOUT it.
    const render = renderResult(states, manifest.route, appCss)
    const panels: [string, string, string][] = [['files', 'Files', renderFileGroup(files, 'files')]]
    if (manifest.wire?.length) panels.push(['wire', 'Requests', renderWire(manifest.wire)])
    if (manifest.bench) panels.push(['bench', 'Bench', renderBench(manifest.bench)])
    if (manifest.tests) panels.push(['tests', 'Tests', renderTests(manifest.tests)])

    let tabs = ''
    let bodies = ''
    for (const [key, label, body] of panels) {
        const selected = key === 'files'
        tabs += `<button role="tab" aria-selected="${selected}" data-panel="${key}">${label}</button>`
        bodies += `<div class="ex-panel" data-panel="${key}"${selected ? '' : ' hidden'}>${body}</div>`
    }

    const html = `<figure class="example">
<figcaption><span class="ex-title">${escapeHtml(manifest.title)}</span><span class="ex-summary">${escapeHtml(manifest.summary)}</span></figcaption>
${render}
<div class="ex-tabs"><div class="ex-tablist" role="tablist">${tabs}</div>${renderDownload(name, root)}</div>
${bodies}
</figure>`

    return { name, html }
}

// The same example directory the panels are built from, flattened for a reader who gets
// TEXT instead of tabs. Files and wire only: `compiled`, `vanilla`, `bench` and `tests`
// are claims ABOUT the framework rather than the answer to the page's problem, and they
// ship in the zip this links to.
export async function exampleMarkdown(name: string, root: string): Promise<string> {
    const manifest: Manifest = await Bun.file(new URL(`${name}/example.json`, EXAMPLES_DIR)).json()
    const files = await readGroup(
        name,
        'files',
        orderedFiles(manifest.files, manifest.about ?? 'ui'),
    )

    let markdown = `**${manifest.title}** — ${manifest.summary}\n`
    for (const file of files) {
        // The extension IS the fence language for every file kind an example holds, so
        // the label reads exactly like a hand-written fence in `content/`.
        const language = file.path.slice(file.path.lastIndexOf('.') + 1)
        markdown += `\n\`\`\`${language} ${displayPath(file.path)}\n${file.source.trimEnd()}\n\`\`\`\n`
    }
    for (const entry of manifest.wire ?? []) {
        let exchange = entry.request
        for (const [header, value] of Object.entries(entry.requestHeaders))
            exchange += `\n${header}: ${value}`
        exchange += `\n\n${entry.status}`
        for (const [header, value] of Object.entries(entry.responseHeaders))
            exchange += `\n${header}: ${value}`
        markdown += `\n\`\`\`http\n${exchange}\n\n${entry.body}\n\`\`\`\n`
    }
    return `${markdown}\nThe whole example, runnable: [${name}.zip](${root}examples/${name}.zip)\n`
}
