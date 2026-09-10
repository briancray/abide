// An EXAMPLE is a DIRECTORY, not a fence: real files that the build can one day
// compile, serve, test and bench, per docs/BRAND.md ("Documentation structure"). This module
// reads one and renders what a page embeds with `{% example name %}`: the panelled component
// for the site, and the same files as fences for the markdown bundle.
//
// SCAFFOLDING, with a seam that is meant to survive: `result`, `wire` and
// `bench` are read from the example DIRECTORY rather than written into this file, so
// when the compiler and the harness land they replace those artifacts and nothing here
// changes. Today they are checked-in static content.

import {
    displayPath,
    escapeHtml,
    highlight,
    renderInline,
    sideOf,
} from './renderMarkdown.ts'

const EXAMPLES_DIR = new URL('../examples/', import.meta.url)
const APP_STYLESHEET = new URL('../src/ui/app.css', import.meta.url)
const FONTS =
    'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;600&family=Space+Grotesk:wght@600;700&display=swap'

type ExampleFile = { path: string; source: string }

// Runs INSIDE the result frame, and it is now two things rather than five: the frame reports
// its own height, and it declines a wheel it has nowhere to put. The mirror, the transform
// table and the transition posting all LEFT with the state machine — a `mirror` rule stood in
// for code the page was teaching, and the arm the frame runs now is that code.
const DRIVER = `<script>
// The frame is as tall as its content, and only the frame can know that. It reports
// rather than the parent measuring, because the parent has no origin to read across.
function measure() {
  parent.postMessage({ abideHeight: document.documentElement.scrollHeight }, '*')
}
new ResizeObserver(measure).observe(document.documentElement)
// THE FRAME LOADS BEFORE THE PAGE'S OWN SCRIPT DOES, so its first counts are posted into a
// document with no listener yet and the meter stays empty until something else moves. The parent
// asks once it is ready and this answers, which is the only ordering that does not depend on a
// resize happening after.
addEventListener('message', () => {
  measure()
})
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
measure()
</script>`

// THE TOKEN A FIXTURE COUNTS WITH, substituted at serve time with how many times that exchange
// has been answered. It exists because a wire fixture is authored and therefore frozen, and some
// domain data is a COUNT — a record's views, a quota's remainder — so a frozen one cannot say the
// thing the example is about. Quoted in the fixture and unquoted on the way out, so the authored
// body is valid JSON and so is the answer.
//
// IT IS NOT INSTRUMENTATION. A field here is one the app would ship, and it is now the only
// count a card carries: a counter kept in the source to be rendered was noise in the code the
// reader came to read, and the code is what has to be short enough to prove the heading (40.32).
const HITS = '{{hits}}'

// A LATENCY IS THE POINT, not a nicety: a fixture that answers in the same tick paints the
// settled value on the first frame, so `pending()` has no moment a reader could see it in.
//
// AND HOW LONG IS A PROPERTY OF WHAT THE CARD IS SHOWING. 450ms is a spinner a reader sees
// because the spinner is still there when they arrive. A card whose subject is the FIRST FRAME
// has the opposite shape: the window shuts on its own, and 450ms of it is gone before the page
// has finished loading — measured, every sample after `goto` resolved already read the settled
// state. So an entry may say its own, and the default stands everywhere else.
const LATENCY = 450

// AND SO IS THE GAP BETWEEN FRAMES. A FEED SETTLED WHOLE IS NOT A FEED: hand an ndjson
// fixture back as one body and every change lands before the first paint, so the example
// that is about folding a change into a held list renders a finished table and folds
// nothing a reader can see. Longer than the latency, so the first frame arrives after the
// list it changes rather than racing it.
const FRAME_GAP = 1200

// THE NETWORK THE ARM TALKS TO IS `wire`, which is what makes one artifact of two: the panel
// under the render used to be a hand-kept screenshot of an exchange nothing performed, and it
// is now the fixture the exchange is served from. A request is resolved to EXACTLY ONE entry
// or the build fails, which is the snippet anchor's rule reaching a second mechanism — none
// means the arm asks for something the page never documented, two means the fixture cannot
// say which answer it meant.
//
// Matched on the ARGS and not the address, because the two arms genuinely disagree there: the
// hand-written one fetches `/api/customer` and abide's handler answers at
// `/__abide/rpc/customers/getCustomer`. What they cannot disagree about is the arguments, both
// being implementations of one call — so the args carry the match and the last path segment
// only has to be RELATED, which is what keeps two endpoints taking `{ id }` apart.
const NETWORK = `<script>
const FIXTURES = JSON.parse(document.querySelector('[data-fixtures]').textContent)
const SERVED = Object.create(null)
const BASE = 'http://example.invalid'
const FRAME_GAP = ${FRAME_GAP}
// THE ARM'S OWN SERVER, for an example whose manifest names one. \`Bun.serve\` is what an app
// author writes, so the file in \`vanilla/\` stays real Bun code and this stands in for the
// runtime that would run it: the route map is captured on the call and dispatched into below.
let ROUTES = null
globalThis.Bun = { serve: (options) => { ROUTES = options.routes ?? null } }
function argsOf(url) {
  const args = {}
  for (const [key, value] of url.searchParams) args[key] = value
  return JSON.stringify(Object.entries(args).sort())
}
// AN NDJSON FIXTURE IS ONE LINE PER FRAME, and the gap between them is what makes the
// difference between a feed and a body: enqueued a line at a time so the arm reads them as
// they land, which is also the only reading under which the wire panel's
// \`transfer-encoding: chunked\` is true of anything.
function framed(body) {
  const lines = body.split('\\n')
  const encoder = new TextEncoder()
  let at = 0
  return new ReadableStream({
    async pull(controller) {
      if (at === lines.length) return controller.close()
      await new Promise((resolve) => setTimeout(resolve, FRAME_GAP))
      controller.enqueue(encoder.encode(lines[at] + '\\n'))
      at += 1
    },
  })
}
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url, BASE)
  // A ROUTE ANSWERS FIRST, and it answers a FAMILY where a fixture answers one address — which
  // is what a field filtering as it types needs. The pathname is the whole of the match: a
  // \`:param\` route falls through to the fixtures and then to the tip, which names the address
  // it could not answer rather than failing silently.
  const route = ROUTES && ROUTES[url.pathname]
  if (route) {
    await new Promise((resolve) => setTimeout(resolve, ${LATENCY}))
    return route(new Request(url, init))
  }
  const tail = url.pathname.slice(url.pathname.lastIndexOf('/') + 1).toLowerCase()
  const args = argsOf(url)
  const match = FIXTURES.find((entry) => entry.args === args && (tail.includes(entry.tail) || entry.tail.includes(tail)))
  if (!match) {
    const note = document.createElement('p')
    note.className = 'tip'
    note.textContent = 'Nothing answers ' + url.pathname + url.search + (ROUTES ? '. Add a route to this example\\'s server arm.' : '. Add it to this example\\'s wire.')
    document.body.append(note)
    measure()
    throw new Error('unanswered ' + url.pathname)
  }
  SERVED[match.key] = (SERVED[match.key] ?? 0) + 1
  await new Promise((resolve) => setTimeout(resolve, match.latency))
  // A FIXTURE FIELD THAT COUNTS. The quotes go with the token, so what lands is a JSON number
  // and the body stays parseable. This is the one thing a static fixture cannot say on its own:
  // that an answer is different BECAUSE it was asked for again.
  //
  // PER EXCHANGE, not per handler: a record's own count belongs to that RECORD, so one handler
  // asked for two ids would otherwise raise the number on both.
  const body = match.body.replaceAll('"${HITS}"', String(SERVED[match.key]))
  return new Response(match.streamed ? framed(body) : body, { status: match.status, headers: match.headers })
}
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
    return [...paths].sort(
        (a, b) => seams.indexOf(sideOf(a)) - seams.indexOf(sideOf(b)),
    )
}

// Only `title`, `summary`, `files`, `result` and `route` are owed. A panel an example
// has no artifact for is NOT RENDERED — a Requests tab on an example that makes no request
// would be a claim about work that never happened, so Result is a lone pane there.
export type Manifest = {
    title: string
    summary: string
    files: string[]
    route: string
    // WHICH OF THE FOUR APPS the pattern is drawn from, per docs/BRAND.md, "The four apps an
    // example is drawn from". Declared rather than inferred from the words, because what the
    // clause governs is a page's examples AGREEING, and prose cannot be compared.
    app: string
    // THE ARM IS WHAT RUNS. `vanilla/` is the hand-written implementation every bench ratio is
    // already against, so the frame has real code to serve rather than a film strip of it: what
    // the panel claims about a request count is a count the arm made.
    //
    // WHAT IS SHOWN IS STILL THE `.abide` SOURCE. The arm is the substrate until there is a
    // compiler, and the Files panel is the page's own source — so the equivalence between the two
    // is a claim NOTHING CHECKS, and it is the one gap this design has. The bench's line counts
    // are the only place the arm is visible today.
    about?: 'ui' | 'server'
    // THE FILE IN `vanilla/` WHOSE ROUTES ANSWER THE ARM, for an example whose network cannot be
    // frozen: a field filtering as it types asks a different address per keystroke, and a wire
    // fixture answers one. Unset everywhere else, where the wire is the network and the panel and
    // the answer are one artifact. Every arm's `server.ts` is the file this would name — eight of
    // them import a `./database.ts` that is not there and so cannot be built or named yet.
    served?: string
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
        latency?: number
    }[]
    bench?: {
        note: string
        rows: {
            metric: string
            abide: string
            vanilla: string
            ratio: string
        }[]
    }
}

// TWO FIXTURES A REQUEST CANNOT BE TOLD APART BY is the half of this that is checkable without
// running anything, and it is refused at build. The other half — a request no fixture answers —
// is NOT statically knowable, the arm building its address at the call (`/api/${path}`), so that
// one is made loud at runtime instead: the shim paints the unanswered address into the frame
// rather than falling through to a `fetch` a sandboxed srcdoc cannot make, which would hang.
export function checkFixtures(name: string, entries: Fixture[]): void {
    for (let index = 0; index < entries.length; index += 1) {
        for (let other = index + 1; other < entries.length; other += 1) {
            const one = entries[index]
            const two = entries[other]
            if (!one || !two) continue
            if (one.args === two.args && relates(one.tail, two.tail))
                throw new Error(
                    `example ${name}: ${one.name} and ${two.name} take the same args and no request tells them apart`,
                )
        }
    }
}

// AND A REQUEST NO FIXTURE ANSWERS is the half that was called not statically knowable. For a
// COMPUTED address it is — `/api/${path}` cannot be resolved without running the arm — but every
// literal one can be, and a literal is what an arm actually writes. So the same failure is now
// refused at build for the case a build can reach, and the runtime tip is what is left for the
// computed address rather than the only line of defence: `patch-a-list` shipped an arm fetching
// `/api/orders` against an empty wire, and the tip only says so to a reader who opens the page.
export function checkRequests(
    name: string,
    script: string,
    entries: Fixture[],
    served?: string,
): void {
    // AND A TRANSPORT THE FRAME DOES NOT SHIM IS THE WORSE HALF, because it is silent: `fetch`
    // is replaced and `WebSocket` is not, so an arm opening one inside a srcdoc with no origin
    // resolves it against the PARENT's and 404s — an example that renders its chrome, none of
    // its content, and no tip. `tail` shipped that way and read as a console with nothing in it.
    const unshimmed = UNSHIMMED.exec(script)
    if (unshimmed)
        throw new Error(
            `example ${name}: the arm opens a ${unshimmed[1]}, which the frame has no fixture for`,
        )
    // AN ARM THAT SERVES ITSELF IS NOT CHECKED AGAINST THE WIRE, the two loops below asking
    // whether a fixture answers an address the routes answer instead. What still holds it is
    // the transport check above and `served-arms.test.ts`, which dispatches every wire entry
    // through the routes and compares the body — so the panel and the network cannot drift.
    if (served) return
    for (const [, address] of script.matchAll(FETCHED_ADDRESS)) {
        if (!address) continue
        const url = new URL(address, 'http://example.invalid')
        const tail = url.pathname.slice(url.pathname.lastIndexOf('/') + 1)
        const args: [string, string][] = []
        for (const pair of url.searchParams) args.push(pair)
        const wanted = JSON.stringify(args.sort())
        const answered = entries.some(
            (one) => one.args === wanted && relates(tail, one.tail),
        )
        if (!answered)
            throw new Error(
                `example ${name}: the arm fetches ${address} and no fixture answers it`,
            )
    }

    // AND A COMPUTED ADDRESS STILL SAYS MOST OF IT. The interpolation hides the VALUES and leaves
    // everything around them standing: `?warehouse=${where}` names its arg KEY whatever `where`
    // turns out to be. That gap shipped in three arms at once — each put an argument in the PATH
    // where the fixture carries it in the QUERY, so no request any of them ever made could be
    // answered and the frame's runtime tip was the only thing that said so. Kept apart from the
    // loop above rather than folded into it, because the two ask different questions: that one
    // asks whether THIS request is answered, this one whether a request of this SHAPE could be.
    //
    // IT REACHES TWO OF THOSE THREE AND NOT THE THIRD, and the third is why the tip stays. A bare
    // `/api/stock/${key}` names no key either, so its shape is a no-arg request — and a no-arg
    // fixture existed, the POST beside it. Statically that is `/api/${path}` with `path` a handler
    // NAME, which is what the arm above this one legitimately writes; the two are the same shape
    // and only the runtime tail tells them apart. Refusing an interpolated last segment would take
    // both.
    for (const [, address] of script.matchAll(INTERPOLATED_ADDRESS)) {
        if (!address) continue
        const cut = address.indexOf('?')
        const path = cut === -1 ? address : address.slice(0, cut)
        const query = cut === -1 ? '' : address.slice(cut + 1)
        // A `$` in the path hides the tail, a segment with no literal name hides the keys, and a
        // half that did not resolve is not checked rather than guessed at — `/api/${path}?${query}`
        // resolves neither and is skipped whole, which is what the arm above this one writes.
        const tail = path.includes('$')
            ? null
            : path.slice(path.lastIndexOf('/') + 1)
        const keys: string[] = []
        let named = true
        for (const segment of query ? query.split('&') : []) {
            const at = segment.indexOf('=')
            const key = at === -1 ? '' : segment.slice(0, at)
            if (!key || key.includes('$')) named = false
            else keys.push(key)
        }
        if (tail === null && !named) continue
        const wanted = named ? JSON.stringify(keys.sort()) : ''
        const answered = entries.some((one) => {
            if (tail !== null && !relates(tail, one.tail)) return false
            if (!named) return true
            const names: string[] = []
            for (const [key] of JSON.parse(one.args) as [string, string][])
                names.push(key)
            return JSON.stringify(names.sort()) === wanted
        })
        if (!answered)
            throw new Error(
                `example ${name}: the arm fetches ${address} and no fixture takes those arguments`,
            )
    }
}

// A `$` in the quotes is an interpolation, which is the computed address the first loop cannot
// resolve — skipped there rather than guessed at, so its refusal never fires on an address it
// misread, and taken by the second loop for the half of it that does resolve.
const FETCHED_ADDRESS = /\bfetch\(\s*['"`]([^'"`$]+)['"`]/g
const INTERPOLATED_ADDRESS = /\bfetch\(\s*`([^`]*\$\{[^`]*)`/g

// The two the wire cannot answer. Kept as a list rather than "anything but fetch" because the
// refusal has to name what it saw, and a shim for either is the fix if an example ever needs one.
const UNSHIMMED = /\bnew (WebSocket|EventSource)\b/

// The arm and the handler are two implementations of one call, so their addresses differ by
// vocabulary rather than by subject: `/api/customer` against `/__abide/rpc/customers/getCustomer`.
// Containment either way is the whole of the relation, and it is deliberately loose — what makes
// it safe is the check above, which refuses a fixture set this cannot separate.
export function relates(one: string, two: string): boolean {
    const a = one.toLowerCase()
    const b = two.toLowerCase()
    return a.includes(b) || b.includes(a)
}

// Every panel that holds files reads the same way, so they share one loader and one
// renderer rather than four that drift.
async function readGroup(
    name: string,
    folder: string,
    paths: string[],
): Promise<ExampleFile[]> {
    const group: ExampleFile[] = []
    for (const path of paths) {
        const file = Bun.file(
            new URL(`${name}/${folder}/${path}`, EXAMPLES_DIR),
        )
        if (!(await file.exists()))
            throw new Error(`example ${name}: ${folder}/${path} is missing`)
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
        const counted = entry.body.includes(HITS)
            ? `<p class="ex-note"><code>${escapeHtml(HITS)}</code> is how many times this exchange has been answered, filled in when it is served.</p>`
            : ''
        bodies += `<div data-file="wire:${index}"${selected ? '' : ' hidden'}>
<p class="ex-line ex-request"><code>${escapeHtml(entry.request)}</code></p>
${renderHeaders(entry.requestHeaders)}
<p class="ex-line ex-status"><code>${escapeHtml(entry.status)}</code></p>
${renderHeaders(entry.responseHeaders)}
<pre><code>${highlight(entry.body)}</code></pre>
${counted}
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
    const note = tests.note
        ? `<p class="ex-note">${renderInline(tests.note)}</p>`
        : ''
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

// WHAT THE RESULT FRAME TAKES FROM THE APP STYLESHEET, by SELECTOR. Lifted rather than
// restated so an example renders the way an abide page renders and the two cannot drift —
// which is also the failure mode: rename one of these in app.css and the frame quietly
// loses that rule, with the page still rendering. The check in `snippet.test.ts` is what
// makes that loud.
//
// MATCHED ON THE PARSED SELECTOR, NEVER ON THE FILE'S TEXT. These used to be literal
// prefixes like `'\nh1, h2, h3, h4, p,'` and a reformat of app.css broke six of them at
// once — a selector list the formatter had split one-per-line still means the same rule,
// and a lookup that reads the punctuation cannot know that. Normalised, a reflow is a
// non-event and a RENAME still trips the gate, which is the half worth catching.
export const FRAME_RULES = [
    ':root',
    '@media (prefers-color-scheme: dark)',
    // An arm hides its own pending and error branches with `hidden`, and the frame body is
    // a flex column now — so this travels with the rest or those branches all render.
    '[hidden]',
    // The margin reset comes first and is not optional: the frame is a flex column like the
    // page is, so a UA margin left standing would be added to the gap rather than replaced
    // by it — and only one of the two would answer to the scale.
    'h1, h2, h3, h4, p, ul, ol, li, pre, figure, table, blockquote, aside',
    'h1',
    'a',
    'a[aria-current]',
    'ul, ol',
    '.switch',
    '.switch a',
    '.switch a:hover',
    '.switch a[aria-current]',
    // The shared control box first, the field's own colours after it — the order they are
    // in above, and the order the frame needs them concatenated in.
    'input, textarea, select, button',
    'input, textarea, select',
    'select',
    'input:focus-visible, textarea:focus-visible, select:focus-visible',
    'button, label',
    'button',
    'button:hover:not(:disabled)',
    'button:disabled',
    '.row',
    '.row:has(> label)',
    'label',
    'label input, label select, label textarea',
    'label:has(> input[type=checkbox]), label:has(> input[type=radio])',
    // A demo card's stat row, its field rows and the status line, so a card renders the way
    // the site would rather than only where the site is.
    '.grid',
    '.grid li',
    '.grid li span',
    '.grid li strong',
    '.fields',
    '.fields li',
    '.fields li span',
    '.fields li strong',
    '.fields.stacked',
    '.fields.stacked li',
    '.fields.stacked li span',
    '.fields.stacked li strong',
    // A transcript, for the chat app's cards. The speaker attribute selectors travel with
    // the block or every turn renders on the same side.
    '.chat',
    '.chat li',
    '.chat li span',
    '.chat li p',
    '.chat li[data-speaker=you]',
    '.chat li[data-speaker=you] p',
    '.stepper',
    '.stepper button',
    '.status',
    '.tabs',
    '.tabs button',
    '.tabs button:hover',
    '.tabs button[aria-selected=true]',
    '.tip',
    '.tip::before',
    '.tip button',
    '.tip button:hover',
    '.tip code',
]

// Every TOP-LEVEL rule in a stylesheet, keyed by its selector with comments stripped and
// whitespace collapsed — so `h1,\n h2 {` and `h1, h2 {` are one key. The VALUE starts at
// the selector rather than at the doc comment above it, the frame wanting the rule and not
// the essay. `@media` is a rule like any other here and is lifted whole, its nested rules
// never reaching this map — which is what keeps a dark-scheme `:root` from shadowing the
// light one. No comment in this stylesheet carries a brace, and the depth count assumes it.
export function rulesBySelector(css: string): Map<string, string> {
    const rules = new Map<string, string>()
    let depth = 0
    let from = 0
    let selector = ''
    let opensAt = 0
    for (let index = 0; index < css.length; index += 1) {
        const character = css[index]
        if (character === '{') {
            if (depth === 0) {
                const raw = css.slice(from, index)
                const comment = raw.lastIndexOf('*/')
                let at = comment === -1 ? 0 : comment + 2
                while (at < raw.length && /\s/.test(raw[at] ?? '')) at += 1
                opensAt = from + at
                selector = raw.slice(at).replace(/\s+/g, ' ').trim()
            }
            depth += 1
        } else if (character === '}') {
            depth -= 1
            if (depth === 0) {
                if (selector) rules.set(selector, css.slice(opensAt, index + 1))
                from = index + 1
                selector = ''
            }
        }
    }
    return rules
}

// The result renders in an IFRAME so the docs' own stylesheet cannot reach it — a
// rendered heading picking up this page's colour would misreport the output.
//
// What it DOES take from the app stylesheet is the TOKENS, lifted from that file
// rather than restated here, so an example cannot drift into a second design system
// and a palette change reaches it for free. Only the tokens: the site's chrome is a
// sidebar grid, and a page that is not the docs would be wrecked by it.
function renderResult(
    arm: { markup: string; script: string; server: string },
    fixtures: Fixture[],
    route: string,
    appCss: string,
): string {
    // Tokens AND the element defaults, so an example with no `<style>` of its own
    // renders the way an abide page renders. Every rule is lifted from the app
    // stylesheet rather than restated, except `body` — the site's own is a sidebar
    // grid, which is chrome rather than a default. What the arm's body IS is the same
    // column the page is: the scale arrives with the tokens, so the distance between two
    // blocks of a rendered example is the one the docs use for prose.
    const rules = rulesBySelector(appCss)
    const base = FRAME_RULES.map((selector) => rules.get(selector) ?? '').join(
        '',
    )
    // `<` is escaped in the FIXTURES and nowhere else. A `\\u003c` is legal inside a JSON string
    // and is a SyntaxError in code — `held.at \\u003c TTL` does not parse — so escaping the arm the
    // same way stopped its bundle dead, and stopped it the quiet way: a script that fails to parse
    // reports nowhere, the classic scripts beside it still run, and the render looks like a load
    // that never finished. The arm needs no escape: the whole document goes into `srcdoc` through
    // `escapeHtml`, so its `</script>` is `&lt;/script&gt;` in the attribute and `</script>` in the
    // frame.
    const data = JSON.stringify(fixtures).replaceAll('<', '\\u003c')
    // After the shim, which is what defines the `Bun.serve` the routes are captured on.
    const server = arm.server ? `<script>${arm.server}</script>` : ''
    const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="${FONTS}">
<style>${base}
body { margin:0; padding:1.5rem; background:var(--paper); color:var(--ink);
  font:400 1rem/1.5rem var(--sans);
  display:flex; flex-direction:column; gap:var(--gap-flow); }
</style>${arm.markup}
<script type="application/json" data-fixtures>${data}</script>${NETWORK}${server}${DRIVER}
<script>${arm.script}</script>`

    // RELOAD, not replay and not reset. The frame re-runs the arm from nothing, which is what
    // a reader who has spent the cache wants and is the one word that is true of it — where
    // "replay" promised a performance and "reset" promised a restored state, and the arm has
    // neither, only a first load it can do again.
    //
    // `allow-scripts` WITHOUT `allow-same-origin`: the arm has to run, and withholding the
    // origin is what keeps it from reaching this document. The parent hears about the request
    // count by message rather than by reading the frame.
    //
    // `loading="lazy"` was here and did NOTHING, which is worth stating so it does not
    // come back: the attribute defers a FETCH, and a srcdoc frame has no fetch to defer.
    // Measured 2642px below the fold with the attribute set and the frame's own script
    // already run. What the page does instead is restart the arm on first intersection,
    // which is in `buildDocs.ts` because only the parent can see where the frame is.
    return `<div class="ex-browser">
<p class="ex-live">Live</p>
<iframe class="ex-result" title="The rendered output of ${escapeHtml(route)}" sandbox="allow-scripts" srcdoc="${escapeHtml(html)}"></iframe>
<button type="button" class="ex-replay" data-reload>Reload</button>
</div>`
}

function renderDownload(name: string, root: string): string {
    return `<a class="ex-download" href="${root}examples/${name}.zip" download>Download</a>`
}

export type Example = { name: string; html: string }

// The ARM is one markup file and one entry module, bundled so a cross-file import resolves —
// `sharing` splits its store across three files, and a srcdoc frame has no origin to fetch a
// second one from. The `<script src>` the markup names is REMOVED rather than rewritten: the
// bundle is inlined after it, so leaving the tag would ask the frame for a file that is not
// there and log a failure per render.
//
// EMITTED AS A CLASSIC SCRIPT, WRAPPED. A `type=module` script does not run in a frame sandboxed
// without `allow-same-origin`, and it fails the quiet way: the tag is in the document, the
// classic scripts beside it run, and the arm simply never starts — a render that looks like a
// slow load. The wrapper is `async` rather than bare because `patch-a-list` awaits at the top
// level, which is legal in a module and is what an IIFE build refuses outright.
async function bundled(
    name: string,
    folder: URL,
    file: string,
): Promise<string> {
    const built = await Bun.build({
        entrypoints: [new URL(file, folder).pathname],
        target: 'browser',
        format: 'esm',
    })
    if (!built.success)
        throw new Error(`example ${name}: vanilla/${file} did not build`)
    const [output] = built.outputs
    if (!output)
        throw new Error(`example ${name}: vanilla/${file} produced nothing`)
    const bundle = await output.text()
    if (/^\s*(import|export)\b/m.test(bundle))
        throw new Error(
            `example ${name}: vanilla/${file} bundles to a module, not a script`,
        )
    return `;(async () => {\n${bundle}\n})()`
}

async function readArm(
    name: string,
    served?: string,
): Promise<{ markup: string; script: string; server: string }> {
    const folder = new URL(`${name}/vanilla/`, EXAMPLES_DIR)
    const page = Bun.file(new URL('index.html', folder))
    if (!(await page.exists()))
        throw new Error(`example ${name}: vanilla/index.html is missing`)
    const markup = await page.text()
    // Built the same way as the page's own script and emitted before it, so the route map is
    // captured by the time the arm makes its first request.
    const server = served ? await bundled(name, folder, served) : ''
    const entry = /<script[^>]*src="\.\/([^"]+)"[^>]*><\/script>/.exec(markup)
    // An arm with no script at all is legitimate: `app-stylesheet` is about what the cascade
    // does, and its markup is the whole of it.
    if (!entry?.[1]) return { markup: markup.trimEnd(), script: '', server }

    return {
        markup: markup.replace(entry[0], '').trimEnd(),
        script: await bundled(name, folder, entry[1]),
        server,
    }
}

// A wire entry, as the frame's shim consumes it. `tail` is the handler name off the address and
// `args` the canonical form of the query, which are the two halves the match is made on.
export type Fixture = {
    name: string
    // WHAT TELLS TWO EXCHANGES OF ONE HANDLER APART, and the key a counted field counts on.
    // `name` cannot serve: one handler asked for two ids shares it.
    key: string
    tail: string
    args: string
    status: number
    headers: Record<string, string>
    body: string
    latency: number
    // Read off the declared content-type rather than set per entry: a feed and a body differ
    // in what the wire panel already says they are, so a second place to say it could disagree
    // with the header a reader is looking at.
    streamed: boolean
}

export function tailOf(request: string): string {
    const address = request.split(' ')[1] ?? request
    const path = address.split('?')[0] ?? ''
    return path.slice(path.lastIndexOf('/') + 1)
}

export function fixturesOf(entries: NonNullable<Manifest['wire']>): Fixture[] {
    const fixtures: Fixture[] = []
    for (const entry of entries) {
        const address = entry.request.split(' ')[1] ?? entry.request
        const query = new URLSearchParams(
            address.slice(address.indexOf('?') + 1),
        )
        const args: [string, string][] = []
        if (address.includes('?')) for (const pair of query) args.push(pair)
        fixtures.push({
            name: tailOf(entry.request),
            key: `${tailOf(entry.request)} ${JSON.stringify(args.sort())}`,
            tail: tailOf(entry.request).toLowerCase(),
            args: JSON.stringify(args.sort()),
            status: Number.parseInt(entry.status, 10) || 200,
            headers: entry.responseHeaders,
            body: entry.body,
            latency: entry.latency ?? LATENCY,
            streamed: (entry.responseHeaders['content-type'] ?? '').includes(
                'ndjson',
            ),
        })
    }
    return fixtures
}

export async function readExample(
    name: string,
    root: string,
): Promise<Example> {
    const manifest: Manifest = await Bun.file(
        new URL(`${name}/example.json`, EXAMPLES_DIR),
    ).json()
    const sourcePaths = orderedFiles(manifest.files, manifest.about ?? 'ui')
    const files = await readGroup(name, 'files', sourcePaths)
    const arm = await readArm(name, manifest.served)
    const fixtures = fixturesOf(manifest.wire ?? [])
    checkFixtures(name, fixtures)
    checkRequests(name, arm.script, fixtures, manifest.served)
    const appCss = await Bun.file(APP_STYLESHEET).text()

    // THE RENDER IS NOT A PANEL. It is the thing the example IS, so it sits above the
    // tabs and stays there — what the tabs hold is everything you consult ABOUT it.
    const render = renderResult(arm, fixtures, manifest.route, appCss)
    const panels: [string, string, string][] = [
        ['files', 'Files', renderFileGroup(files, 'files')],
    ]
    if (manifest.wire?.length)
        panels.push(['wire', 'Requests', renderWire(manifest.wire)])
    if (manifest.bench)
        panels.push(['bench', 'Bench', renderBench(manifest.bench)])
    if (manifest.tests)
        panels.push(['tests', 'Tests', renderTests(manifest.tests)])

    let tabs = ''
    let bodies = ''
    for (const [key, label, body] of panels) {
        const selected = key === 'files'
        tabs += `<button role="tab" aria-selected="${selected}" data-panel="${key}">${label}</button>`
        bodies += `<div class="ex-panel" data-panel="${key}"${selected ? '' : ' hidden'}>${body}</div>`
    }

    const html = `<figure class="example">
<figcaption><span class="ex-title">${renderInline(manifest.title)}</span><span class="ex-summary">${escapeHtml(manifest.summary)}</span></figcaption>
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
export async function exampleMarkdown(
    name: string,
    root: string,
): Promise<string> {
    const manifest: Manifest = await Bun.file(
        new URL(`${name}/example.json`, EXAMPLES_DIR),
    ).json()
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
