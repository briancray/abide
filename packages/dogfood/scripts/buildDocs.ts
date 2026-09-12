#!/usr/bin/env bun

// Renders `content/**.md` into `dist/**.html` against the order in NAV, COPIES each content
// file beside its page, and concatenates the set into `dist/abide.md`.
//
// SCAFFOLDING, and deliberately so: it exists to make the documentation READABLE
// while the words are still being decided, and it is deleted once `abide build` can
// serve these pages itself. The styling below is a reading column and nothing more —
// the design is a later pass, and anything that looks designed here would be judged
// as a design decision it is not.

import { rm } from 'node:fs/promises' // bun has no recursive directory remove of its own
import { buildInjectable } from '../../harness/scripts/buildInjectable.ts'
import { NAV } from './NAV.ts'
import { exampleMarkdown, readExample } from './renderExample.ts'
import {
    EXAMPLE,
    groupSections,
    LEAD,
    renderInline,
    renderMarkdown,
    SNIPPET,
} from './renderMarkdown.ts'
import { snippetHtml, snippetMarkdown } from './renderSnippet.ts'
import { STATUS_PAGE } from './STATUS_PAGE.ts'
import { STATUS_SCRIPT } from './STATUS_SCRIPT.ts'
import { statusRoute } from './statusApi.ts'
import { type ZipEntry, zip } from './zip.ts'

const CONTENT_DIR = new URL('../content/', import.meta.url)
const OUTPUT_DIR = new URL('../dist/', import.meta.url)

export type Page = {
    slug: string
    section: string
    title: string
    nav: string
    intent: string
    covers: string[]
    // The example DIRECTORIES this page embeds, repo-relative. Front matter rather than
    // convention, so an agent reading the markdown alone knows where the files are without
    // being told how `{% example name %}` resolves.
    examples: string[]
    // The REGISTRY sections a reference page enumerates. `covers:` is the guides' claim and a
    // reference page is refused one, so this is the parallel claim for the other document type:
    // a guide claims a capability, a reference page claims a whole section of the surface.
    enumerates: string[]
    stub: boolean
    body: string
}

// Front matter is `key: value` lines between two `---` rules, plus a `- item` list
// form. The list form is not decoration: a capability name may contain a comma, a
// colon or a pipe, so no single-line delimiter is safe for `covers`.
function readFrontMatter(source: string): {
    fields: Map<string, string[]>
    body: string
} {
    const fields = new Map<string, string[]>()
    if (!source.startsWith('---\n')) return { fields, body: source }
    const end = source.indexOf('\n---', 4)
    if (end === -1) return { fields, body: source }

    let current: string[] | undefined
    for (const line of source.slice(4, end).split('\n')) {
        const trimmed = line.trim()
        if (trimmed.startsWith('- ')) {
            current?.push(trimmed.slice(2).trim())
            continue
        }
        const separator = line.indexOf(':')
        if (separator === -1) continue
        const value = line.slice(separator + 1).trim()
        current = value ? [value] : []
        fields.set(line.slice(0, separator).trim(), current)
    }
    return { fields, body: source.slice(source.indexOf('\n', end + 1) + 1) }
}

export async function readPages(): Promise<Page[]> {
    const pages: Page[] = []
    for (const group of NAV) {
        for (const slug of group.pages) {
            const file = Bun.file(new URL(`${slug}.md`, CONTENT_DIR))
            if (!(await file.exists()))
                throw new Error(
                    `buildDocs: NAV names ${slug}, content/${slug}.md is missing`,
                )
            const { fields, body } = readFrontMatter(await file.text())
            pages.push({
                slug,
                section: group.section,
                title: fields.get('title')?.[0] ?? slug,
                nav: fields.get('nav')?.[0] ?? fields.get('title')?.[0] ?? slug,
                intent: fields.get('intent')?.[0] ?? '',
                covers: fields.get('covers') ?? [],
                examples: fields.get('examples') ?? [],
                enumerates: fields.get('enumerates') ?? [],
                stub: fields.get('status')?.[0] === 'stub',
                body,
            })
        }
    }
    return pages
}

// Every href is RELATIVE to the page it sits on, so `dist/index.html` opens over
// file:// with no server in front of it.
function linkTo(from: string, to: string): string {
    const depth = from.split('/').length - 1
    return `${'../'.repeat(depth)}${to}.html`
}

function basename(slug: string): string {
    return slug.slice(slug.lastIndexOf('/') + 1)
}

function renderNav(pages: Page[], current: string): string {
    let html = ''
    let section = ''
    for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index]
        if (!page) continue
        if (page.section !== section) {
            if (section) html += '</ul></section>'
            section = page.section
            html += `<section><h2>${section}</h2><ul>`
        }
        const here = page.slug === current ? ' aria-current="page"' : ''
        const stub = page.stub
            ? '<span class="stub" title="Stub — not written yet"></span>'
            : ''
        html += `<li><a href="${linkTo(current, page.slug)}"${here}>${renderInline(page.nav)}</a>${stub}</li>`
    }
    const closed = section ? `${html}</ul></section>` : html
    // 40.45 — THE ONE SIDEBAR ENTRY THAT IS NOT DOCUMENTATION. It is rendered here
    // rather than listed in `NAV`, and the distinction is load-bearing: `NAV` is what
    // the coverage gates are written over — every content page reachable from it,
    // every section showing its opening on the overview, every label held to the
    // voice rules — and a slug in it with no `content/` file behind it would make all
    // of them lie. Last, under its own heading, so a reader learning what a value is
    // reaches every page of the documentation before they reach the build's suites.
    // See docs/DECISIONS.md D127.
    const here = current === STATUS_SLUG ? ' aria-current="page"' : ''
    return `${closed}<section><h2>Build</h2><ul><li><a href="${linkTo(current, STATUS_SLUG)}"${here}>Status</a></li></ul></section>`
}

const STATUS_SLUG = 'status'

// The heading list is read off the RENDERED body rather than the markdown, so a heading's
// link text is the same inline HTML the heading itself got — a `code` span included.
function renderHeadingList(body: string): string {
    const pattern = /<h([23]) id="([^"]+)">(.*?)<\/h\1>/g
    let items = ''
    let count = 0
    for (let match = pattern.exec(body); match; match = pattern.exec(body)) {
        count += 1
        items += `<li class="lvl-${match[1]}"><a href="#${match[2]}">${match[3]}</a></li>`
    }
    // One heading is not a table of contents, it is a repeat of the title.
    return count < 2 ? '' : items
}

// The rail is where a reader is already looking for "what else is here", so the markdown
// downloads sit under the heading list rather than in the nav. It renders on EVERY page:
// a page with one heading has no table of contents and still has a download.
function renderRail(
    headings: string,
    markdownName: string,
    root: string,
): string {
    const contents = headings
        ? `<section><h2 id="toc-title">On this page</h2><ul aria-labelledby="toc-title">${headings}</ul></section>`
        : ''
    return `<aside class="toc">${contents}<section><h2 id="md-title">Markdown</h2>
<ul class="downloads" aria-labelledby="md-title">
<li><a href="${markdownName}" download>Download this page</a></li>
<li><a href="${root}abide.md" download>Download full docs</a></li>
</ul></section></aside>`
}

// Scroll-spy. Offsets are MEASURED ONCE — on load, on resize, and after the webfonts
// swap, which is itself a reflow — so the scroll handler is arithmetic with no layout
// read in it. An IntersectionObserver band was tried first and got two cases wrong:
// nothing was active at the top, and the last sections never activated because at max
// scroll they never enter the band.
const SCROLL_SPY = `
const headings = [...document.querySelectorAll('main h2[id], main h3[id]')]
const links = headings.map((h) => document.querySelector('.toc a[href="#' + h.id + '"]'))
let offsets = []
let current = -1

function measure() {
  offsets = headings.map((h) => h.getBoundingClientRect().top + window.scrollY)
  update()
}

function update() {
  const line = window.scrollY + 80
  let next = 0
  for (let i = 0; i < offsets.length; i += 1) if (offsets[i] <= line) next = i
  // At the bottom there is no room left to scroll the last heading up to the line.
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
    next = offsets.length - 1
  }
  if (next === current) return
  links[current]?.removeAttribute('aria-current')
  links[next]?.setAttribute('aria-current', 'true')
  current = next
}

let queued = false
addEventListener('scroll', () => {
  if (queued) return
  queued = true
  requestAnimationFrame(() => { queued = false; update() })
}, { passive: true })
addEventListener('resize', measure, { passive: true })
document.fonts?.ready.then(measure)
measure()
`

// THE BRIDGE THE INSTRUMENTED FRAME GETS, appended after the harness and before the
// arm. It belongs to the DOCUMENTATION rather than to the harness — 40.21 — so it
// lives here beside the rest of the page's own script rather than in the injectable.
const MEASURE_BRIDGE = `
// THE LOAD IS A CASE WITH NO BODY, armed here — before the arm's first line and after
// the harness has installed its patches. Counting a load is the documentation's doing
// rather than the lane's, so the lane offers the pair and this is what opens one.
globalThis.__HARNESS_MEASURE__.armCase()
addEventListener('message', (event) => {
  const ask = event.data && event.data.abideMeasure
  if (!ask) return
  const lane = globalThis.__HARNESS_MEASURE__
  if (!lane) return
  // ONE ARM RUNS IN THIS FRAME and it is the hand-written one, which is what the
  // frame has always rendered. The abide arm would be a second entry here and a
  // second callable in this same document — batched in ONE call, or ratio() refuses
  // the pair on unequal n — and there is nothing to put in it until the compiler
  // emits a page.
  const runs = {}
  if (ask.selector) {
    // THE OP IS FIRED THOUSANDS OF TIMES, so it is resolved once and the handler is
    // what repeats. Re-querying per call would price the selector.
    const target = document.querySelector(ask.selector)
    if (target) runs['hand-written'] = () => { target.dispatchEvent(new Event(ask.event, { bubbles: true })) }
  }
  let reading = null
  let refused = null
  try {
    reading = lane.profile({
      op: ask.op || 'load',
      runs,
      baseline: 'hand-written',
      loadedArm: 'hand-written',
      scriptBytes: ask.scriptBytes || 0,
    })
  } catch (error) {
    // A REFUSAL IS THE RESULT. The batcher throws rather than returning a reading of
    // the clock, and the panel says which refusal rather than showing nothing.
    refused = String((error && error.message) || error)
  }
  parent.postMessage({ abideReading: reading, abideRefused: refused, abideWindow: Math.round(performance.now()) }, '*')
})
// THE LOAD IS NOT OVER AT PARSE. An arm fetches its fixture, the fixture answers
// after a declared latency, and the render that matters happens then — so a reading
// taken when the script tag finished reports the synchronous prologue and nothing
// else. Measured on the first working run: 1 listener bound, 0 nodes created, and
// the arm had built twelve.
//
// So the frame reports when the DOM has gone QUIET, which is the one signal that
// does not need to know what the arm is waiting for. A mutation restarts the clock;
// a ceiling stops an arm that never settles from never reporting.
// LONGER THAN A FIXTURE'S LATENCY, which is 450 ms. At 200 the detector fired during
// the network wait — the DOM is perfectly quiet while an arm waits for its answer —
// and the reading came back with 1 node created against the 20 the arm went on to
// build. A streamed feed never settles at all (a frame every 1200 ms), so the window
// is REPORTED rather than pretended to be the whole load.
const SETTLE_MILLISECONDS = 700
const LOAD_CEILING_MILLISECONDS = 4000
let settleTimer = null
let reported = false
function announce() {
  if (reported) return
  reported = true
  parent.postMessage({ abideMeasureReady: 1 }, '*')
}
function restartSettle() {
  clearTimeout(settleTimer)
  settleTimer = setTimeout(announce, SETTLE_MILLISECONDS)
}
new MutationObserver(restartSettle).observe(document.documentElement, {
  childList: true, subtree: true, attributes: true, characterData: true,
})
addEventListener('load', restartSettle)
restartSettle()
setTimeout(announce, LOAD_CEILING_MILLISECONDS)
`

// Panel tabs and file tabs are the same interaction, so one delegated listener per example serves
// both rather than a listener per button. RELOAD rides along, and it re-runs the arm from nothing
// rather than replaying anything: the frame's transient states are the arm's own, so a first load
// is something to do again rather than a strip to play.
const EXAMPLE_TABS = `
const MEASURE_BRIDGE = ${JSON.stringify(MEASURE_BRIDGE)}
for (const example of document.querySelectorAll('.example')) {
  const browser = example.querySelector('.ex-browser')
  const frame = browser?.querySelector('.ex-result')
  const source = frame?.getAttribute('srcdoc')


  addEventListener('message', (event) => {
    if (!frame || event.source !== frame.contentWindow) return
    // A measured height, which is the one thing a stylesheet cannot know.
    if (event.data && event.data.abideHeight) {
      frame.style.height = event.data.abideHeight + 'px'
      return
    }
    // The gesture the frame declined, put back where the reader aimed it.
    if (event.data && event.data.abideWheel) {
      scrollBy(event.data.abideWheel.x, event.data.abideWheel.y)
      return
    }
    // The instrumented frame is ready to be asked.
    if (event.data && event.data.abideMeasureReady) { askToMeasure(); return }
    if (event.data && (event.data.abideReading || event.data.abideRefused)) {
      paintReading(event.data.abideReading, event.data.abideRefused, event.data.abideWindow)
      return
    }
  })


  // THE READING, RENDERED, in the same four columns as the Bench table beside it —
  // metric, abide, hand-written, ratio. The abide column is EMPTY rather than absent:
  // a missing column reads as a table that does not compare, and an empty one reads
  // as the comparison that has not happened yet, which is the true statement.
  const COUNTS = [
    ['Elements moved', 'elementsMoved'], ['Markers moved', 'markersMoved'],
    ['Text nodes moved', 'textMoved'], ['Nodes created', 'nodesCreated'],
    ['Attributes set', 'attributesSet'], ['Class writes', 'classWrites'],
    ['Style writes', 'styleWrites'], ['Data writes', 'dataWrites'],
    ['Redundant data writes', 'redundantDataWrites'], ['Listeners bound', 'listenersBound'],
    ['Binding runs', 'bindingRuns'], ['Wakes', 'wakes'], ['Descents', 'descents'],
  ]
  const ENGINES = { v8: 'V8', jsc: 'JavaScriptCore', spidermonkey: 'SpiderMonkey', unknown: 'an engine we could not name' }
  const ARMS = ['abide', 'hand-written']
  const NOTHING = '\u2014'

  function escapeText(value) {
    return String(value).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
  }
  function millis(nanoseconds) {
    if (nanoseconds >= 1e6) return (nanoseconds / 1e6).toFixed(2) + ' ms'
    if (nanoseconds >= 1e3) return (nanoseconds / 1e3).toFixed(2) + ' \u00b5s'
    return Math.round(nanoseconds) + ' ns'
  }
  function refusalHtml(why) {
    return '<p class="ex-measure-refused">' + escapeText(why) + '</p>'
    + '<button type="button" class="ex-measure-run" data-measure-run>Try again</button>'
  }
  function cell(value) {
    return '<td>' + (value === null || value === undefined ? '<span class="ex-tag">' + NOTHING + '</span>' : '<code>' + escapeText(value) + '</code>') + '</td>'
  }
  // A TAG IS NOT A NUMBER. ratio() hands back a discriminated result and the tags are
  // the whole reason: two values inside the measured floor do not divide, and a
  // frame-quantised pair divides to 1.01x, which is the claim the harness exists to
  // refuse.
  function ratioCell(answer) {
    if (!answer) return '<td class="ex-ratio"><span class="ex-tag">' + NOTHING + '</span></td>'
    if (answer.kind === 'underTheFloor') return '<td class="ex-ratio"><span class="ex-tag">under the floor</span></td>'
    if (answer.kind === 'underOneFrame') return '<td class="ex-ratio"><span class="ex-tag">under one frame</span></td>'
    const klass = answer.value === 1 ? '' : answer.value < 1 ? ' class="ex-good"' : ' class="ex-bad"'
    return '<td class="ex-ratio"><code' + klass + '>' + answer.value.toFixed(2) + 'x</code></td>'
  }
  function armCount(reading, arm, key) {
    if (arm === reading.loadedArm) return reading.load[key]
    return null
  }
  function tableHtml(caption, rows) {
    if (!rows) return ''
    return '<table class="ex-bench"><thead><tr><th>' + caption + '</th><th>abide</th>'
      + '<th>Hand-written</th><th class="ex-ratio">Ratio</th></tr></thead><tbody>' + rows + '</tbody></table>'
  }
  function loadRows(reading) {
    let rows = ''
    for (const [label, key] of COUNTS) {
      const value = reading.load[key]
      // A NULL IS NOT A ZERO. Wakes, binding runs and descents are read off a record
      // abide publishes, and nothing publishes one yet — so the cell says the lane
      // did not count it rather than that it counted none.
      if (value === null || !value) continue
      rows += '<tr><td>' + label + '</td>'
        + cell(armCount(reading, 'abide', key)) + cell(armCount(reading, 'hand-written', key))
        + ratioCell(null) + '</tr>'
    }
    const paint = reading.paint || {}
    const first = paint.firstContentfulPaint != null ? paint.firstContentfulPaint : paint.firstPaint
    if (first != null) {
      rows += '<tr><td>First paint</td>' + cell(reading.loadedArm === 'abide' ? first.toFixed(1) + ' ms' : null)
        + cell(reading.loadedArm === 'hand-written' ? first.toFixed(1) + ' ms' : null) + ratioCell(null) + '</tr>'
    }
    rows += '<tr><td>Nodes in the document</td>' + cell(reading.loadedArm === 'abide' ? reading.size.nodes : null)
      + cell(reading.loadedArm === 'hand-written' ? reading.size.nodes : null) + ratioCell(null) + '</tr>'
    return rows
  }
  function opRows(reading) {
    if (!reading.timing) return ''
    let rows = ''
    for (const [label, key] of COUNTS) {
      const values = ARMS.map((arm) => reading.arms[arm] ? reading.arms[arm].work[key] : null)
      if (values.every((value) => value === null || !value)) continue
      rows += '<tr><td>' + label + '</td>' + values.map(cell).join('')
        + ratioCell(values[0] !== null && values[1] ? { kind: 'ratio', value: values[0] / values[1] } : null) + '</tr>'
    }
    rows += '<tr><td>Time per op</td>'
      + ARMS.map((arm) => cell(reading.arms[arm] ? millis(reading.arms[arm].nanosecondsPerOp) : null)).join('')
      + ratioCell(reading.ratios.abide) + '</tr>'
    rows += '<tr><td>p95</td>'
      + ARMS.map((arm) => cell(reading.arms[arm] ? millis(reading.arms[arm].p95) : null)).join('')
      + ratioCell(null) + '</tr>'
    return rows
  }
  function readingHtml(reading, windowMs) {
    if (!reading) return refusalHtml('The frame reported nothing.')
    const engine = ENGINES[reading.substrate] || reading.substrate
    let html = tableHtml('On load', loadRows(reading))
    html += tableHtml(escapeText(reading.op), opRows(reading))
    // WHY THE ABIDE COLUMN IS EMPTY, said once and plainly. An empty column with no
    // explanation reads as a measurement that came back zero.
    const missing = ARMS.filter((arm) => arm !== reading.loadedArm && !reading.arms[arm])
    if (missing.length) {
      html += '<p class="ex-note">The <strong>' + missing.join(' and ') + '</strong> column is empty because that arm does not run yet '
        + '\u2014 the compiler has to emit a page before there is anything to load beside the hand-written one. '
        + 'Both arms have to be batched in ONE run, or the two get different sample sizes and the ratio is refused.</p>'
    }
    let facts = ['counted over the first <strong>' + windowMs + ' ms</strong>']
    if (reading.paint && reading.paint.longTasks) facts.push('<strong>' + reading.paint.longTasks + '</strong> long tasks')
    if (reading.timing) {
      facts.push('<span class="ex-reading-detail">n=' + reading.timing.n + ' \u00b7 ' + reading.timing.reps
        + ' reps \u00b7 floor \u00b1' + (reading.timing.floor * 100).toFixed(2) + '%</span>')
    }
    html += '<p class="ex-note">' + facts.join(' \u00b7 ') + '</p>'
    html += '<p class="ex-note">Measured in <strong>your</strong> browser just now, on ' + engine
      + ', whose clock steps every ' + millis(reading.clockNanoseconds) + '.'
      + (reading.timing ? '' : ' No repeatable op is named here, so there is no duration to batch.')
      + ' These are not our numbers and they are not a claim \u2014 the counts are the same everywhere, the timings are yours.</p>'
    html += '<button type="button" class="ex-measure-run" data-measure-run>Measure again</button>'
    return html
  }

  // THE MEASURE PANEL. A reading cannot be taken retroactively — counting a load
  // means arming before the arm's first line — so this reloads the frame with the
  // instrument prepended. The harness is fetched once per page and only if asked,
  // so a reader who never opens the panel pays nothing at all.
  // Still the data-measure hook: the live half kept it when it moved into the Bench
  // panel, so nothing here has to know which tab it is under.
  const measurePanel = example.querySelector('[data-measure]')
  let harness = null
  let measuring = false

  function askToMeasure() {
    if (!measuring) return
    const ask = { op: 'load', scriptBytes: (source || '').length }
    if (measurePanel?.dataset.selector) {
      ask.op = measurePanel.dataset.op
      ask.selector = measurePanel.dataset.selector
      ask.event = measurePanel.dataset.event
    }
    frame?.contentWindow?.postMessage({ abideMeasure: ask }, '*')
  }

  function paintReading(reading, refused, windowMs) {
    measuring = false
    if (!measurePanel) return
    measurePanel.innerHTML = refused ? refusalHtml(refused) : readingHtml(reading, windowMs)
  }

  async function measureHere() {
    if (measuring || !frame || source === null || !measurePanel) return
    measuring = true
    measurePanel.innerHTML = '<p class="ex-note">Running the arm again with the counters armed…</p>'
    if (harness === null) {
      try {
        // RESOLVED AGAINST THE STYLESHEET, not against the page. A page two
        // directories down asked for its own measure.js, got the 404 body back, and
        // put "404" in a script tag — the frame then had no instrument and never
        // announced. Both assets are emitted side by side from the same root, so the
        // one the page already links is the address of the other.
        // BY HREF, not by rel: the fonts stylesheet is linked first, and a bare
        // link[rel=stylesheet] matched it — the page then fetched a font-face sheet,
        // put CSS in a script tag, and the frame died on the first @.
        const beside = document.querySelector('link[rel=stylesheet][href$="docs.css"]')?.href
        if (!beside) throw new Error('the page links no docs.css to resolve against')
        const answer = await fetch(beside.replace(/docs\\.css.*$/, 'measure.js'))
        // A 404 BODY IS NOT AN INSTRUMENT. Unchecked, it became the script.
        if (!answer.ok) throw new Error('measure.js answered ' + answer.status)
        const text = await answer.text()
        // AND NEITHER IS A STYLESHEET. Two wrong things have been fetched into this
        // slot already, and both failed as a parse error in a sandboxed frame that
        // reports nowhere. What arrives has to name itself.
        if (!text.includes('__HARNESS_MEASURE__'))
          throw new Error('what answered is not the measure lane')
        harness = text
      } catch (error) {
        measuring = false
        harness = null
        measurePanel.innerHTML = refusalHtml('The instrument did not load: ' + error)
        return
      }
    }
    // BEFORE the arm and before anything else the frame runs: the patches have to be
    // installed and the load case armed at document-start, or the load counts are of
    // whatever happened after the instrument arrived.
    // ONE ESCAPE, IN ONE PLACE. The bridge carries no script tags of its own — an
    // escaped terminator inside a template literal inside a JSON string inside an
    // inline script is three layers of quoting, and it got the backslash wrong twice.
    // The tags are written here, where the harness's already are.
    frame.srcdoc = '<script>' + harness + '<\\/script><script>' + MEASURE_BRIDGE + '<\\/script>' + source
  }

  // Registered above, so now ask: the frame has already run and already counted.
  function ask() { frame?.contentWindow?.postMessage({ abideAsk: 1 }, '*') }
  frame?.addEventListener('load', ask)
  ask()

  // AN ARM THAT RAN BEFORE THE READER ARRIVED HAS ALREADY FINISHED, and a card whose subject is
  // the FIRST FRAME then has nothing left to show: a srcdoc frame starts at parse, so one 2600px
  // down spends its whole first load off every screen. Measured on the provisional card, where
  // both arms read settled however early the sample was taken. Restarted on first intersection,
  // so what a reader scrolls into is a load BEGINNING rather than one that ended while they were
  // somewhere else — and uniformly, because a card already on screen restarts on the same tick it
  // would have run anyway. This is what lazy loading promised and could not do: that attribute
  // defers a FETCH, and a srcdoc frame has none.
  if (frame && source !== null) {
    let started = false
    new IntersectionObserver((entries, watcher) => {
      if (started || !entries.some((entry) => entry.isIntersecting)) return
      started = true
      watcher.disconnect()
      frame.srcdoc = source
    }).observe(frame)
  }

  example.addEventListener('click', (event) => {
    if (event.target.closest('[data-reload]')) {
      if (frame && source !== null) frame.srcdoc = source
      return
    }
    if (event.target.closest('[data-measure-run]')) { measureHere(); return }
    const button = event.target.closest('button[role=tab]')
    if (!button) return
    const panel = button.dataset.panel
    if (panel) {
      for (const tab of example.querySelectorAll('.ex-tablist button')) {
        tab.setAttribute('aria-selected', String(tab === button))
      }
      for (const body of example.querySelectorAll('.ex-panel')) body.hidden = body.dataset.panel !== panel
      return
    }
    const file = button.dataset.file
    if (!file) return
    const group = file.slice(0, file.indexOf(':') + 1)
    for (const tab of example.querySelectorAll('.ex-files button')) {
      if (tab.dataset.file.startsWith(group)) tab.setAttribute('aria-selected', String(tab === button))
    }
    for (const body of example.querySelectorAll('.ex-panel > [data-file]')) {
      if (body.dataset.file.startsWith(group)) body.hidden = body.dataset.file !== file
    }
  })
}
`

// AN INLINE SCRIPT THAT DOES NOT PARSE FAILS NOWHERE. The page's own script is a
// template literal holding another template literal holding a JSON string, and four
// separate escaping mistakes shipped through this seam: a raw `</script>` that ended
// the tag early, a `\/` that collapsed to `/`, a nested single quote, and a stylesheet
// fetched into a script tag. Every one produced a silent dead page — a script that
// fails to parse reports to nothing, the tabs simply stop working, and the render
// beside them looks fine.
//
// So the build parses what it is about to write. A `SyntaxError` here names the page.
function checkInlineScripts(slug: string, html: string): void {
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
        const source = match[1] ?? ''
        if (!source.trim()) continue
        try {
            new Function(source)
        } catch (error) {
            throw new Error(
                `buildDocs: ${slug} emits an inline script that does not parse — ${error instanceof Error ? error.message : String(error)}`,
            )
        }
    }
}

// A section overview OWNS its opening paragraphs; the main overview SHOWS the same words
// by pulling them, so the seam between the two cannot drift. The lead is everything before
// the section page's first `##`.
function leadOf(pages: Page[], slug: string): string {
    const source = pages.find((candidate) => candidate.slug === slug)
    if (!source)
        throw new Error(
            `buildDocs: {% lead ${slug} %} names a page NAV does not list`,
        )
    const lead = source.body.split(/^## /m)[0]?.trim() ?? ''
    if (!lead)
        throw new Error(
            `buildDocs: ${slug} has no lead — its body opens on a heading`,
        )
    // It renders on pages at other depths, so a relative link would resolve wrong.
    if (/]\((?!https?:|#)/.test(lead))
        throw new Error(
            `buildDocs: the lead of ${slug} has a relative link; leads render elsewhere`,
        )
    return lead
}

export async function renderPage(
    page: Page,
    pages: Page[],
    index: number,
): Promise<string> {
    const previous = pages[index - 1]
    const next = pages[index + 1]
    const root = '../'.repeat(page.slug.split('/').length - 1)
    const markdownName = `${basename(page.slug)}.md`
    let body = renderMarkdown(page.body)
    // Re-read per page rather than caching: the download links are relative to the
    // page they sit on, and there are two example embeds in the whole site.
    // LEAD FIRST: a lead is a section page's opening, and an opening carries the example
    // that page leads with — so the passes that expand one have to run after it, or the
    // overview ships the marker instead of the figure.
    for (const match of [...body.matchAll(/<!--lead:([\w/-]+)-->/g)]) {
        const lead = renderMarkdown(leadOf(pages, match[1] ?? ''))
        body = body.replace(match[0], () => lead)
    }
    for (const match of [...body.matchAll(/<!--example:([\w-]+)-->/g)]) {
        const example = await readExample(match[1] ?? '', root)
        body = body.replace(match[0], () => example.html)
    }
    for (const match of [...body.matchAll(/<!--snippet:(\{.*?\})-->/g)]) {
        const html = await snippetHtml(JSON.parse(match[1] ?? '{}'))
        body = body.replace(match[0], () => html)
    }
    body = linksToHtml(body)

    const hasExample = body.includes('<figure class="example"')
    const headings = renderHeadingList(body)
    let footer = ''
    if (previous)
        footer += `<a href="${linkTo(page.slug, previous.slug)}">&larr; ${renderInline(previous.nav)}</a>`
    if (next)
        footer += `<a class="next" href="${linkTo(page.slug, next.slug)}">${renderInline(next.nav)} &rarr;</a>`

    return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title.replaceAll('`', '')} — abide</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;600&family=Space+Grotesk:wght@600;700&display=swap">
<link rel="stylesheet" href="${root}docs.css">
<link rel="alternate" type="text/markdown" href="${markdownName}" title="${page.title.replaceAll('`', '')} as Markdown">
<body class="has-toc">
<a class="skip" href="#content">Skip to content</a>
<nav>
<a class="brand" href="${root}index.html">abide<span>docs</span></a>
${renderNav(pages, page.slug)}
</nav>
<main id="content">
<header>
${page.stub ? '<p class="notice">Stub — title and intent decided, prose not written.</p>' : ''}
<h1>${renderInline(page.title)}</h1>
${page.intent ? `<p class="intent">${renderInline(page.intent)}</p>` : ''}
</header>
${groupSections(body)}
<footer>${footer}</footer>
</main>
${renderRail(headings, markdownName, root)}
${headings ? `<script>${SCROLL_SPY}</script>` : ''}
${hasExample ? `<script>${EXAMPLE_TABS}</script>` : ''}
</body>
</html>
`
}

// THE DASHBOARD, THROUGH THE SAME SHELL. It gets the brand, the sidebar and the
// reading column every other page gets, and it is the one page in the output with no
// `content/` file behind it — 40.45 puts it in the navigation and keeps it out of
// `NAV`, which is what the rest of this file reads pages from.
//
// No rail and no footer: there is no "on this page" for a page whose sections are
// empty until somebody presses a button, and no previous or next for a page that is
// not in the reading order.
export function renderStatusPage(pages: Page[]): string {
    return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Status — abide</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;600&family=Space+Grotesk:wght@600;700&display=swap">
<link rel="stylesheet" href="docs.css">
<body>
<a class="skip" href="#content">Skip to content</a>
<nav>
<a class="brand" href="index.html">abide<span>docs</span></a>
${renderNav(pages, STATUS_SLUG)}
</nav>
<main id="content">
${STATUS_PAGE}
</main>
<script src="status.js"></script>
</body>
</html>
`
}

// MARKDOWN IS THE PAGE and HTML is derived from it, so `content/` links name the `.md`
// — which is what makes a content file correct when it is read where it lies, on GitHub
// or as a download, rather than only after a build. This is the derivation. An absolute
// URL keeps its own.
function linksToHtml(html: string): string {
    return html.replace(/href="(?!https?:|#)([^"]+)\.md/g, 'href="$1.html')
}

// The page EXPANDED — front matter as a heading, directives as fences — which is what every
// markdown reader gets, the per-page download and the bundle alike. `content/<slug>.md` is the
// source and keeps its hints; a reader who wants those has the repo.
export async function renderPageMarkdown(
    page: Page,
    pages: Page[],
): Promise<string> {
    const root = '../'.repeat(page.slug.split('/').length - 1)
    let body = page.body.trim()
    // The directives expand into FENCES rather than panels — same source, same order,
    // no tab a reader of plain text cannot open. LEAD runs first for the reason the HTML
    // path gives: an opening it pulls in may itself embed an example or a snippet.
    //
    // EVERY REPLACEMENT TAKES THE FUNCTION FORM. A string replacement is not literal —
    // `String.replace` reads `$&`, `` $` ``, `$'` and `$1` out of it — so an example
    // holding `'$'` for a currency sign inserted the entire rest of the document and left
    // every directive after it unexpanded, with the build still exiting 0.
    for (const match of [...body.matchAll(new RegExp(LEAD.source, 'gm'))]) {
        const lead = leadOf(pages, match[1] ?? '')
        body = body.replace(match[0], () => lead)
    }
    for (const match of [...body.matchAll(new RegExp(EXAMPLE.source, 'gm'))]) {
        const markdown = await exampleMarkdown(match[1] ?? '', root)
        body = body.replace(match[0], () => markdown)
    }
    for (const match of [...body.matchAll(new RegExp(SNIPPET.source, 'gm'))]) {
        const markdown = await snippetMarkdown({
            example: match[1] ?? '',
            file: match[2] ?? '',
            anchor: match[3] ?? '',
        })
        body = body.replace(match[0], () => markdown)
    }

    let head = `# ${page.title}\n`
    if (page.intent) head += `\n*${page.intent}*\n`
    if (page.stub)
        head += `\n> Stub — title and intent decided, prose not written.\n`
    return `${head}\n${body}\n`
}

// ONE FILE in reading order, for an agent that would otherwise fetch seventy. The text is
// the per-page `.md` verbatim; what this adds is the ORDER, the grouping the nav carries,
// and each page's own path — without which its relative links resolve against nothing.
export function renderBundle(pages: Page[], rendered: string[]): string {
    let contents = ''
    let section = ''
    let body = ''
    for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index]
        if (!page) continue
        if (page.section !== section) {
            section = page.section
            contents += `\n**${section}**\n\n`
        }
        contents += `- ${page.nav} — \`${page.slug}.md\`${page.stub ? ' (stub)' : ''}\n`
        body += `\n---\n\n<!-- ${page.slug}.md -->\n\n${rendered[index] ?? ''}`
    }
    return `# abide documentation

The whole of the abide documentation in reading order. Every page is also served on its own
at the \`.md\` beside its \`.html\`, and the links below point at those files — relative to
the path each page's marker comment names.

## Contents
${contents}${body}`
}

// The design brief lives in `src/ui/app.css` — a REAL stylesheet at the address the
// app's own `import '#ui/app.css'` will resolve to once `.abide` compiles, so the CSS
// does not have to move when the scaffold goes.
//
// The design brief in one place. The SIGNATURE is the code-block spine: every snippet
// names which side it runs on, because "same name, both sides" is the thing abide is
// claiming and a reader scanning for "where does this run" is the commonest question
// these docs answer. Amber is reserved for NOT-YET states — stubs, pending — and is
// never used decoratively, so its presence always means the same thing.
const STYLESHEET_SOURCE = new URL('../src/ui/app.css', import.meta.url)

// ONE SERVER, ONE OUTPUT. Every page including the dashboard is a file out of `dist`;
// what this adds over a static host is `/api/*`, which is where the dashboard's
// numbers come from.
//
// It used to be a SECOND server, in `harness/scripts`, on the same port, answering a
// superset of these routes and importing `buildDocs` to get there. That is a
// measurement package depending on the app it measures, and two servers that cannot
// both be up. The routes live here now and the harness keeps the producers.
//
// The dashboard is in the sidebar and not in `NAV` — 40.45, and D127 for why.
export function serveDocs(): void {
    const server = Bun.serve({
        port: Number(process.env.DOCS_PORT ?? 4000),
        // BUN'S DEFAULT IS TEN SECONDS and a status run is not a page load. The unit
        // panel streams for sixteen and the bench panel for minutes; at the default
        // the connection was cut at eleven seconds with 22 of 23 rows delivered, and
        // the page rendered "TypeError: network error" over a table that had just
        // filled. 255 is Bun's ceiling, and `statusApi.ts` sends a heartbeat for the
        // runs that outlast even that.
        idleTimeout: 255,
        async fetch(request) {
            const path = new URL(request.url).pathname
            const answered = statusRoute(request)
            if (answered) return answered
            // `/status` without the extension, which is the address the server
            // prints and the one a reader types.
            const name =
                path === '/'
                    ? 'index.html'
                    : path === '/status'
                      ? 'status.html'
                      : path.slice(1)
            const file = Bun.file(new URL(name, OUTPUT_DIR))
            if (await file.exists()) return new Response(file)
            return new Response('not found', { status: 404 })
        },
    })
    console.log(`docs:   ${server.url}`)
    console.log(`status: ${server.url}status`)
}

export async function buildDocs(): Promise<Page[]> {
    const pages = await readPages()
    // Start from empty: a renamed page or a deleted example file otherwise lingers in
    // the output and goes on being served long after its source is gone.
    await rm(OUTPUT_DIR, { recursive: true, force: true })
    const markdown: string[] = []
    for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index]
        if (!page) continue
        const html = await renderPage(page, pages, index)
        checkInlineScripts(page.slug, html)
        await Bun.write(new URL(`${page.slug}.html`, OUTPUT_DIR), html)
        // Indexed rather than pushed: the bundle reads it back by the page's own index.
        const rendered = await renderPageMarkdown(page, pages)
        markdown[index] = rendered
        // The RENDERED page, not a copy of the content file. The copy was byte-identical to
        // the repo file, which is the same thing as the page only while the page carries no
        // directive — a section overview is `{% lead %}` markers and little else, so the
        // download was the markers. `content/<slug>.md` keeps the hints; this is what
        // "Download this page" means by the page.
        await Bun.write(new URL(`${page.slug}.md`, OUTPUT_DIR), rendered)
    }
    await Bun.write(
        new URL('abide.md', OUTPUT_DIR),
        renderBundle(pages, markdown),
    )
    await Bun.write(
        new URL('docs.css', OUTPUT_DIR),
        Bun.file(STYLESHEET_SOURCE),
    )

    // THE MEASURE LANE, AS ONE FILE, and it is emitted rather than inlined. A reader
    // who never opens the panel pays nothing: the frame's `srcdoc` does not carry it,
    // and the page fetches it once on the first Measure click. Inlining it would put
    // 20 kB into every example's `srcdoc` attribute on every page that embeds one.
    await Bun.write(
        new URL('measure.js', OUTPUT_DIR),
        Bun.file(await buildInjectable()),
    )

    // ONE ZIP PER EXAMPLE, so Download is a button rather than a menu. Entries carry
    // the example name as their first segment, so unzipping makes a folder.
    const examplesDir = new URL('../examples/', import.meta.url)
    const archives = new Map<string, ZipEntry[]>()
    for (const path of new Bun.Glob(
        '*/{files,compiled,vanilla,tests}/**',
    ).scanSync({
        cwd: examplesDir.pathname,
    })) {
        const name = path.slice(0, path.indexOf('/'))
        const entries = archives.get(name) ?? []
        entries.push({
            path,
            source: await Bun.file(new URL(path, examplesDir)).text(),
        })
        archives.set(name, entries)
    }
    // The dashboard's shell and its script, written by the BUILD that empties this
    // directory rather than by a run that the next build would delete — which is the
    // ordering D119 refused and D127 can accept, the shell carrying no results.
    await Bun.write(new URL('status.html', OUTPUT_DIR), renderStatusPage(pages))
    await Bun.write(new URL('status.js', OUTPUT_DIR), STATUS_SCRIPT)
    for (const [name, entries] of archives) {
        entries.sort((a, b) => (a.path < b.path ? -1 : 1))
        await Bun.write(
            new URL(`examples/${name}.zip`, OUTPUT_DIR),
            zip(entries),
        )
    }
    return pages
}

if (import.meta.main) {
    const pages = await buildDocs()
    const written = pages.filter((page) => !page.stub).length
    console.log(
        `docs: ${pages.length} pages -> packages/dogfood/dist (${written} written, ${pages.length - written} stubs), html and md, plus abide.md`,
    )

    if (Bun.argv.includes('--serve')) serveDocs()
}
