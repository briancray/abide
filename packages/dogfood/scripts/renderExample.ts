// An EXAMPLE is a DIRECTORY, not a fence: real files that the build can one day
// compile, serve, test and bench, per docs/SPEC.md ("Documentation"). This module
// reads one and renders the panelled component a page embeds with `{% example name %}`.
//
// SCAFFOLDING, with a seam that is meant to survive: `result`, `compiled`, `wire` and
// `bench` are read from the example DIRECTORY rather than written into this file, so
// when the compiler and the harness land they replace those artifacts and nothing here
// changes. Today they are checked-in static content.

import { displayPath, escapeHtml, highlight, renderInline, sideOf } from './renderMarkdown.ts'

const EXAMPLES_DIR = new URL('../examples/', import.meta.url)
const APP_STYLESHEET = new URL('../src/ui/app.css', import.meta.url)
const FONTS =
    'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;600&family=Space+Grotesk:wght@600;700&display=swap'

type ExampleFile = { path: string; source: string }

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
type Manifest = {
    title: string
    summary: string
    files: string[]
    route: string
    // A settled snapshot cannot show `pending()`, so a result is a SEQUENCE. `hold`
    // is how long a state stays before the next one replaces it; the last has none.
    states: { file: string; hold?: number }[]
    about?: 'ui' | 'server'
    compiled?: string[]
    vanilla?: string[]
    // Test RESULTS, not test source: what a reader wants from this panel is whether
    // the example holds, and the spec itself is in the download.
    tests?: { note?: string; rows: { name: string; result: string }[] }
    wire?: {
        request: string
        requestHeaders: Record<string, string>
        status: string
        responseHeaders: Record<string, string>
        body: string
    }[]
    bench: {
        note: string
        rows: { metric: string; abide: string; vanilla: string; ratio: string }[]
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

function renderWire(entries: NonNullable<Manifest['wire']>): string {
    let html = ''
    for (const entry of entries) {
        html += `<p class="ex-line ex-request"><code>${escapeHtml(entry.request)}</code></p>
${renderHeaders(entry.requestHeaders)}
<p class="ex-line ex-status"><code>${escapeHtml(entry.status)}</code></p>
${renderHeaders(entry.responseHeaders)}
<pre><code>${highlight(entry.body)}</code></pre>`
    }
    return html
}

// Result and Wire answer the same question — what came back — so they are one panel
// with two tabs rather than two panels a reader holds side by side. The tablist is the
// one Files already uses; only the bodies differ.
function renderResultGroup(browser: string, wire: Manifest['wire']): string {
    if (!wire?.length) return browser
    const entries = [
        { label: 'Rendered', side: 'browser', body: browser },
        ...wire.map((entry) => ({
            label: entry.request,
            side: 'server',
            body: renderWire([entry]),
        })),
    ]
    let tabs = ''
    let bodies = ''
    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]
        if (!entry) continue
        const selected = index === 0
        tabs += `<button role="tab" aria-selected="${selected}" data-side="${entry.side}" data-file="result:${index}">${escapeHtml(entry.label)}</button>`
        bodies += `<div data-file="result:${index}"${selected ? '' : ' hidden'}>${entry.body}</div>`
    }
    return `<div class="ex-files" role="tablist">${tabs}</div>${bodies}`
}

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
    states: { hold: number; body: string }[],
    route: string,
    appCss: string,
): string {
    // Tokens AND the element defaults, so an example with no `<style>` of its own
    // renders the way an abide page renders. Every rule is lifted from the app
    // stylesheet rather than restated, except `body` — the site's own is a sidebar
    // grid, which is chrome rather than a default.
    const base = [':root', '@media (prefers-color-scheme: dark)', '\nh1 {', '\np {']
        .map((selector) => ruleAt(appCss, selector))
        .join('')
    const document = (body: string) => `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="${FONTS}">
<style>${base}
body { margin:0; padding:1.5rem; background:var(--paper); color:var(--ink);
  font:400 15px/1.6 var(--sans); }</style>${body}`

    const frames = states.map((state) => ({ hold: state.hold, html: document(state.body) }))
    const settled = frames.at(-1)?.html ?? ''
    // `<` is escaped so a state's own markup cannot close this script element.
    const data = JSON.stringify(frames).replaceAll('<', '\\u003c')

    // Replay is only meaningful where there is more than one state to move between.
    const replay = frames.length > 1 ? '<button type="button" data-replay>Replay</button>' : ''

    return `<div class="ex-browser">
<div class="ex-bar"><div class="ex-url"><code>localhost:3000${escapeHtml(route)}</code></div>${replay}</div>
<iframe class="ex-result" title="The example's rendered output" sandbox="allow-same-origin" srcdoc="${escapeHtml(settled)}"></iframe>
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
    const compiled = await readGroup(name, 'compiled', manifest.compiled ?? [])
    const vanilla = await readGroup(name, 'vanilla', manifest.vanilla ?? [])
    const states: { hold: number; body: string }[] = []
    for (const state of manifest.states) {
        const file = Bun.file(new URL(`${name}/${state.file}`, EXAMPLES_DIR))
        if (!(await file.exists())) throw new Error(`example ${name}: ${state.file} is missing`)
        states.push({ hold: state.hold ?? 0, body: await file.text() })
    }
    const appCss = await Bun.file(APP_STYLESHEET).text()

    const panels: [string, string, string][] = [
        ['files', 'Files', renderFileGroup(files, 'files')],
        [
            'result',
            'Result',
            renderResultGroup(renderResult(states, manifest.route, appCss), manifest.wire),
        ],
    ]
    if (compiled.length)
        panels.push(['compiled', 'Compiled', renderFileGroup(compiled, 'compiled')])
    if (vanilla.length) panels.push(['vanilla', 'Vanilla', renderFileGroup(vanilla, 'vanilla')])
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
