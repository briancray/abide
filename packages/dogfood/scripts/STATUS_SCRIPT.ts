// THE STATUS PAGE'S OWN SCRIPT, served as a file rather than inlined. An inline
// script inside a template literal is the seam six escaping bugs shipped through
// while the example panel was being written; a separate file has one layer of quoting
// and the browser reports its own syntax errors. `statusPage.test.ts` parses it.
//
// NO BACKTICKS ANYWHERE BELOW, comments included — this whole file is one template
// literal and a stray one ends it early. String concatenation throughout, for the
// same reason.
//
// A leaf — no imports of its own.
export const STATUS_SCRIPT = `
const sections = document.getElementById('sections')

// ONE ROW PER THING THAT CAN BE RUN. Each is its own endpoint and its own button, so
// a slow one never blocks a fast one and a red one never hides the rest.
const PANELS = [
  { id: 'unit', title: 'Unit and docs', endpoint: '/api/run/unit', kind: 'suites' },
  { id: 'gates', title: 'Gates, with every revert run', endpoint: '/api/run/gates', kind: 'suites' },
  { id: 'browser', title: 'Browser, chromium and webkit', endpoint: '/api/run/browser', kind: 'suites' },
  { id: 'ops', title: 'Reactive, per operation, against a hand-written signal', endpoint: '/api/bench/reactive', kind: 'ops' },
  { id: 'bench', title: 'Bench, measured in a browser', endpoint: '/api/bench', kind: 'bench', slow: 'a few minutes' },
  { id: 'counted', title: 'Counted over the source', endpoint: '/api/counted', kind: 'plain' },
  { id: 'machinery', title: 'Machinery', endpoint: '/api/machinery', kind: 'plain' },
]

const state = {}
const open = {}
// ONE PACKAGE FOR THE WHOLE PAGE. It was a filter per panel and that is two controls
// answering one question — the unit table could sit on abide while the gates table
// sat on all, and the two read as disagreeing about what you were looking at.
//
// A VIEW and nothing else: it narrows the rows and the line that counts them, never
// the verdict.
let filter = 'all'
// The in-flight fetch per panel, so its button can abort it. Aborting the body is
// what the server reads as "stop" — see the cancel handler in statusApi.
const running = {}

function escapeText(value) {
  return String(value).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}

function micro(nanoseconds) {
  if (nanoseconds === null || nanoseconds === undefined) return '\\u2014'
  if (nanoseconds >= 1e6) return (nanoseconds / 1e6).toFixed(2) + ' ms'
  if (nanoseconds >= 1e3) return (nanoseconds / 1e3).toFixed(2) + ' \\u00b5s'
  // TWO SIGNIFICANT FIGURES, not a whole number. A read is 5.9 ns and its hand arm is
  // 2.7 ns; rounded to integers they read 6 and 3, which is a different claim.
  if (nanoseconds >= 100) return Math.round(nanoseconds) + ' ns'
  return nanoseconds.toFixed(nanoseconds >= 10 ? 1 : 2) + ' ns'
}

function milli(value) {
  return value === null || value === undefined ? '\\u2014' : value.toFixed(1) + ' ms'
}

// A COUNT CARRIES A DIRECTION ONLY WHERE ONE IS MEANT. Zero failures is green, any
// failure is red, and a total is neither — so it is body text and says nothing it
// does not mean.
function tone(value, good) {
  if (good === null) return ''
  return good ? ' class="st-ok"' : ' class="st-no"'
}

function cell(value, good) {
  return '<td class="st-num"><code' + tone(value, good) + '>' + escapeText(value) + '</code></td>'
}

function keyValue(rows) {
  let body = ''
  for (const row of rows) {
    if (row[1] === null || row[1] === undefined) continue
    body += '<tr><td class="st-k">' + escapeText(row[0]) + '</td><td class="st-v">' + row[1] + '</td></tr>'
  }
  return '<table>' + body + '</table>'
}

function detailRow(id, span, body) {
  if (!open[id]) return ''
  return '<tr class="st-detail"><td colspan="' + span + '">' + body + '</td></tr>'
}

function caret(id) {
  return '<span class="st-caret">' + (open[id] ? '\\u25be' : '\\u25b8') + '</span> '
}

// ----- suites -----------------------------------------------------------------

function suiteDetail(suite) {
  if (suite.broke) return '<p class="st-failure">' + escapeText(suite.broke) + '</p>'
  let body = ''
  for (const one of suite.cases) {
    const failed = Boolean(one.failure)
    const mark = failed ? '\\u2715' : one.skipped ? '\\u2013' : '\\u2713'
    const tone = failed ? 'st-no' : one.skipped ? 'st-why' : 'st-ok'
    // A DURATION FROM ANOTHER PROCESS IS CHECKED, not trusted. These two sides cannot
    // share a type, and the sender turned a NaN into a null on the way — so the guard
    // is here as well as at the source.
    const took = typeof one.milliseconds === 'number' ? one.milliseconds.toFixed(1) + ' ms' : ''
    body += '<div class="st-case"><span class="' + tone + '">'
      + mark + '</span><span>' + escapeText(one.name) + '</span>'
      + '<span class="st-why">' + (one.skipped ? 'skipped' : took) + '</span></div>'
    if (failed) body += '<p class="st-failure">' + escapeText(one.failure) + '</p>'
  }
  return body || '<p class="ex-note">No cases reported.</p>'
}

function suiteTotals(rows) {
  // DERIVED, not accumulated. A single-file run replaces one row, and a running total
  // that had been added up as lines arrived would count that file twice.
  const total = { passing: 0, failures: 0, skipped: 0, tests: 0, seconds: 0, done: 0 }
  for (const row of rows) {
    if (!row.result) continue
    total.passing += row.result.passing
    total.failures += row.result.failures + (row.result.broke ? 1 : 0)
    total.skipped += row.result.skipped
    total.tests += row.result.tests
    total.seconds += row.result.seconds
    total.done += 1
  }
  return total
}

function suiteRow(panel, row) {
  const id = panel.id + ':' + row.label + ':' + (row.project || '')
  const suite = row.result
  const running = row.state === 'running'
  const cells = suite
    ? cell(suite.passing, suite.failures === 0 && !suite.broke ? true : null)
      + cell(suite.broke ? '!' : suite.failures, suite.failures > 0 || suite.broke ? false : null)
      + cell(suite.skipped, null) + cell(suite.tests, null)
      + '<td class="st-num"><code>' + suite.seconds.toFixed(1) + ' s</code></td>'
    // FOUR DASHES AND A WORD, not an empty row. The table is drawn from the file list
    // before anything runs, so every cell needs something that reads as "not yet"
    // rather than as zero — a zero in the failing column of a suite that has not run
    // is the reading this whole page exists to refuse.
    : '<td class="st-num"><code>\u2014</code></td><td class="st-num"><code>\u2014</code></td>'
      + '<td class="st-num"><code>\u2014</code></td><td class="st-num"><code>\u2014</code></td>'
      + '<td class="st-num"><span class="ex-tag">' + (running ? 'running' : 'queued') + '</span></td>'
  return '<tr class="st-row" data-open="' + escapeText(id) + '"><td>' + caret(id)
    + escapeText(row.label)
    + (row.project ? ' <span class="st-project">' + escapeText(row.project) + '</span>' : '')
    + '</td>' + cells
    // A row the panel did not LIST cannot be run on its own: the file list is what
    // the per-file endpoint validates against, and playwright's rows arrive from a
    // report rather than from a glob.
    + '<td class="st-num">' + (row.project ? '' :
      '<button type="button" class="st-one' + (running ? ' st-cancel' : '')
      + '" data-' + (running ? 'stop' : 'one') + '="' + escapeText(panel.id)
      + '" data-file="' + escapeText(row.label) + '">'
      + (running ? 'Stop' : suite ? 'Again' : 'Run') + '</button>') + '</td></tr>'
    + detailRow(id, 7, suite ? suiteDetail(suite) : '<p class="ex-note">Not run yet.</p>')
}

// THE PACKAGE IS THE SECOND SEGMENT — packages/<name>/tests/... — derived from the
// rows rather than listed, so a fourth package appears here the day it has a test and
// nothing has to be told about it. abide is pinned first: it is the framework, and
// the other two exist to check it.
function packageOf(file) {
  const parts = file.split('/')
  return parts[0] === 'packages' && parts[1] ? parts[1] : 'other'
}

function packagesIn(rows) {
  const seen = []
  for (const row of rows) {
    const name = packageOf(row.label)
    if (seen.indexOf(name) === -1) seen.push(name)
  }
  seen.sort((a, b) => (a === 'abide' ? -1 : b === 'abide' ? 1 : a < b ? -1 : 1))
  return seen
}

function rowsIn(rows, name) {
  return name === 'all' ? rows : rows.filter((row) => packageOf(row.label) === name)
}

// Every suite row on the page, whichever panel listed it. The toggle is one control,
// so its counts are over everything it controls.
function allSuiteRows() {
  const rows = []
  for (const panel of PANELS) {
    const data = state[panel.id]
    if (panel.kind !== 'suites' || !data || !data.rows) continue
    for (const row of data.rows) rows.push(row)
  }
  return rows
}

function filters() {
  const rows = allSuiteRows()
  if (!rows.length) return ''
  let buttons = ''
  for (const name of ['all'].concat(packagesIn(rows))) {
    const within = rowsIn(rows, name)
    const failing = suiteTotals(within).failures
    // A FILTER MUST NOT HIDE RED. Narrowing to one package is a view, so every toggle
    // carries its own failure count and a package with one stays red while you are
    // looking at another.
    buttons += '<button type="button" class="st-filter' + (failing ? ' st-no' : '')
      + '" data-package="' + escapeText(name) + '"'
      + ' aria-pressed="' + (filter === name ? 'true' : 'false') + '">'
      + escapeText(name) + ' <span>' + (failing ? failing + ' failing' : within.length) + '</span></button>'
  }
  return '<div class="st-filters">' + buttons + '</div>'
}

// THE COMMAND AND THE COUNT SIT ON THE HEADING LINE. They were a paragraph of their
// own between the heading and the table, which put three lines of chrome above a
// table that is the point of the panel. It describes the TABLE, so it follows the
// filter and says which package it is counting; the verdict on the same line does
// not, because that one is the panel's.
function suiteNote(panel, data) {
  if (!data || !data.rows || !data.rows.length) return ''
  const shown = rowsIn(data.rows, filter)
  const totals = suiteTotals(shown)
  return '<p class="ex-note st-head-note"><code>' + escapeText(data.command) + '</code> · '
    + (filter === 'all' ? '' : escapeText(filter) + ': ')
    + totals.done + ' of ' + shown.length + ' run'
    + (data.seconds ? ' · ' + data.seconds.toFixed(1) + ' s' : '') + '</p>'
}

function suitesBody(panel, data) {
  if (data.unavailable) return '<p class="ex-note">Not run — ' + escapeText(data.unavailable) + '</p>'
  // The browser panel has no list to draw from: playwright names its own files and
  // only in the report. Everything else is a table from the moment the page loads.
  if (!data.rows.length) return '<p class="ex-note">' + escapeText(data.command) + ' — not run yet.</p>'
  const shown = rowsIn(data.rows, filter)
  let rows = ''
  for (const row of shown) rows += suiteRow(panel, row)
  const head = '<tr><th>Suite</th><th class="st-num">Passing</th><th class="st-num">Failing</th>'
    + '<th class="st-num">Skipped</th><th class="st-num">Total</th><th class="st-num">Time</th>'
    + '<th class="st-num"></th></tr>'
  return '<table class="st"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>'
}

// ----- bench ------------------------------------------------------------------

function workList(work) {
  const parts = []
  for (const key of Object.keys(work || {})) {
    const value = work[key]
    if (value === null || value === undefined || value === 0) continue
    parts.push(key + ' ' + value)
  }
  return parts.length ? escapeText(parts.join(', ')) : '\\u2014'
}

function ratioCell(card) {
  if (card.refused) return '<td class="st-num"><code class="st-no">refused</code></td>'
  // A CARD THAT NAMED NO OP HAS NOTHING TO DIVIDE, and that is different from a card
  // with one arm. Both used to read "one arm", which said the abide arm was the
  // missing one on 60 cards where nothing was timed at all.
  if (!card.arms.length) return '<td class="st-num"><span class="ex-tag">no op</span></td>'
  if (!card.ratio) return '<td class="st-num"><span class="ex-tag">one arm</span></td>'
  if (card.ratio.kind !== 'ratio') return '<td class="st-num"><span class="ex-tag">' + escapeText(refusalOf(card.ratio.kind)) + '</span></td>'
  const value = card.ratio.value
  return '<td class="st-num"><code class="' + (value <= 1 ? 'st-ok' : 'st-no') + '">' + value.toFixed(2) + 'x</code></td>'
}

function armNamed(card, name) {
  for (const arm of card.arms) if (arm.arm === name) return arm
  return null
}

function benchDetail(card) {
  if (card.refused) return '<p class="st-failure">' + escapeText(card.refused) + '</p>'
  const rows = [
    ['page', escapeText(card.page)],
    ['engine', escapeText(card.substrate) + ' \\u00b7 ' + escapeText(card.agent)],
    ['first paint', milli(card.paint.firstPaint)],
    ['first contentful paint', milli(card.paint.firstContentfulPaint)],
    ['long tasks over 50 ms', card.paint.longTasks
      ? '<span class="st-no">' + card.paint.longTasks + '</span>' : '0'],
    ['nodes in the document', card.size.nodes],
    ['script bytes', card.size.scriptBytes],
    ['work on load', workList(card.load)],
    ['sample', card.timing
      ? 'n=' + card.timing.n + ', ' + card.timing.reps + ' reps, floor \\u00b1'
        + (card.timing.floor * 100).toFixed(1) + '%'
      : null],
    ['clock resolution', micro(card.clockNanoseconds)],
  ]
  for (const arm of card.arms) {
    rows.push([arm.arm + ' \\u00b7 per op', micro(arm.nanosecondsPerOp)])
    rows.push([arm.arm + ' \\u00b7 p95', micro(arm.p95)])
    rows.push([arm.arm + ' \\u00b7 work', workList(arm.work)])
  }
  return keyValue(rows)
}

function benchBody(panel, data) {
  if (!data.rows.length) return '<p class="ex-note">Not run yet. Takes a few minutes.</p>'
  let rows = ''
  for (const row of data.rows) {
    const id = panel.id + ':' + row.label + ':' + row.project
    const card = row.result
    const abide = card ? armNamed(card, 'abide') : null
    const hand = card ? armNamed(card, 'hand-written') : null
    rows += '<tr class="st-row" data-open="' + escapeText(id) + '"><td>' + caret(id)
      + escapeText(row.label)
      + (row.project ? ' <span class="st-project">' + escapeText(row.project) + '</span>' : '')
      + '</td>'
      + '<td><code>' + escapeText(card ? card.op || '\\u2014' : '\\u2014') + '</code></td>'
      + '<td class="st-num"><code>' + micro(abide ? abide.nanosecondsPerOp : null) + '</code></td>'
      + '<td class="st-num"><code>' + micro(hand ? hand.nanosecondsPerOp : null) + '</code></td>'
      + (card
          ? ratioCell(card)
          : '<td class="st-num"><span class="ex-tag">'
            + (row.state === 'running' ? 'running' : 'queued') + '</span></td>')
      + '</tr>'
    rows += detailRow(id, 5, card ? benchDetail(card) : '<p class="ex-note">Not measured yet.</p>')
  }
  const head = '<tr><th>Example</th><th>Op</th><th class="st-num">Time</th>'
    + '<th class="st-num">Hand-written</th><th class="st-num">Ratio</th></tr>'
  return '<p class="ex-note">Chromium, driven over the same panel a reader drives. Counts are the same in every engine; the timings are this machine and this minute. The time column is the abide arm and is empty until one exists \\u2014 a ratio needs two arms batched in one run.</p>'
    + '<table class="st"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>'
}

// ----- the per-operation ratios -----------------------------------------------

// THE RATIO'S REFUSALS ARE NAMED FOR A TYPE, NOT FOR A COLUMN. underTheFloor
// clipped to underTheFlo at 6rem, which is a tag a reader cannot read. What each one
// MEANS is short.
const REFUSALS = {
  underTheFloor: 'within floor',
  underOneFrame: 'under a frame',
}

function refusalOf(kind) {
  return REFUSALS[kind] || kind
}

function ratioOf(value) {
  // LOWER IS BETTER and 1.0 is parity, so the colour is about which side of it the
  // number falls. It is not a pass or a fail: the machinery is bought on purpose and
  // what this says is what it cost.
  return '<code class="' + (value <= 1 ? 'st-ok' : 'st-no') + '">' + value.toFixed(2) + 'x</code>'
}

// THE TWO ARMS, SIDE BY SIDE, and this is what the row is for. A ratio is a claim
// about two pieces of code and the only way to read it is to see both — so the
// expansion leads with them and puts the sample underneath. The source is taken off
// the arm that was timed, so it cannot be the code that used to be there.
//
// AND WHAT EACH LEANS ON, WHICH IS NOT SYMMETRIC. The hand column's mechanism is
// twenty lines and all of it is there; the abide column's is 1331, so what is there
// is the entry point the op calls. That difference is not a gap in the page, it is
// the thing the ratio is measuring.
function leaning(on) {
  let body = ''
  for (const one of on || [])
    // The NAME IS NOT UPPERCASED. The label is, and an identifier inside it came out
    // as REACTIVENODE.PRODUCE — the same trap the reading's small print already
    // carries a note about, where uppercasing turned 1.16 µs into 1.16 ΜS.
    body += '<p class="st-note">leaning on <span class="st-name">'
      + escapeText(one.name) + '</span></p>'
      + '<pre class="st-code"><code>' + escapeText(one.source) + '</code></pre>'
  return body
}

function opsDetail(row) {
  return '<div class="st-arms">'
    + '<div><p class="st-note">abide</p><pre class="st-code"><code>'
      + escapeText(row.abideSource) + '</code></pre>' + leaning(row.abideLeaning) + '</div>'
    + '<div><p class="st-note">hand-written</p><pre class="st-code"><code>'
      + escapeText(row.handSource) + '</code></pre>' + leaning(row.handLeaning) + '</div>'
    + '</div>'
    + keyValue([
      ['n per sample', row.n + ', ' + row.reps + ' reps'],
      ['A/A floor', '\\u00b1' + (row.floor * 100).toFixed(2) + '%'],
      ['abide \\u00b7 p95', micro(row.abideP95)],
      ['hand-written \\u00b7 p95', micro(row.handP95)],
      ['work disagreement', row.workDisagreement.length
        ? '<span class="st-no">' + escapeText(row.workDisagreement.join(', ')) + '</span>'
        : 'none'],
    ])
}

function opsBody(panel, data) {
  if (!data.rows.length) return '<p class="ex-note">Not run yet.</p>'
  let body = ''
  for (const row of data.rows) {
    const id = panel.id + ':' + row.label
    const one = row.result
    body += '<tr class="st-row" data-open="' + escapeText(id) + '"><td>' + caret(id)
      + escapeText(row.label) + '</td>'
      + (one
          ? '<td class="st-num"><code>' + micro(one.abideNanoseconds) + '</code></td>'
            + '<td class="st-num"><code>' + micro(one.handNanoseconds) + '</code></td>'
            + '<td class="st-num">'
            + (one.ratio.kind === 'ratio'
                ? ratioOf(one.ratio.value)
                : '<span class="ex-tag">' + escapeText(refusalOf(one.ratio.kind)) + '</span>')
            + '</td>'
          : '<td class="st-num"><code>\\u2014</code></td><td class="st-num"><code>\\u2014</code></td>'
            + '<td class="st-num"><span class="ex-tag">'
            + (row.state === 'running' ? 'running' : 'queued') + '</span></td>')
      + '</tr>'
    body += detailRow(id, 4, one ? opsDetail(one) : '<p class="ex-note">Not measured yet.</p>')
  }
  const head = '<tr><th>Operation</th><th class="st-num">abide</th>'
    + '<th class="st-num">Hand-written</th><th class="st-num">Ratio</th></tr>'
  return '<p class="ex-note">One operation at a time, both arms batched in one interleaved run, against the hand-written signal in harness/measure/vanilla. Nanoseconds are this machine and this minute; the ratio is the claim. A row with a hand arm of two or three nanoseconds has a noisy quotient and a steady left-hand column \\u2014 open it for both arms, and for the floor. The code shown is the code the engine ran, taken off the timed function after types were stripped, which is why a boolean reads as !0. THE FIRST ROW IS THE FLOOR: both its arms are the same code, so it reports about 1.00x, and its absolute number is what the loop and the accumulator cost on every other row \\u2014 which pulls a cheap row\\u0027s quotient toward 1 and leaves a dear one alone. Under each arm is what it leans on: all twenty lines of the hand-written signal, and for abide the entry point the op calls, which is the asymmetry the ratio is about.</p>'
    + '<table class="st"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>'
}

// ----- the two that are read rather than run ----------------------------------

function countedBody(panel, data) {
  if (!data.rows.length) return '<p class="ex-note">No example carries a counted row yet.</p>'
  let rows = ''
  for (const row of data.rows) {
    const value = Number.parseFloat(row.ratio)
    const klass = !Number.isFinite(value) || value === 1 ? '' : value < 1 ? ' class="st-ok"' : ' class="st-no"'
    rows += '<tr><td>' + escapeText(row.example) + '</td><td>' + escapeText(row.metric) + '</td>'
      + '<td class="st-num"><code>' + escapeText(row.abide) + '</code></td>'
      + '<td class="st-num"><code>' + escapeText(row.vanilla) + '</code></td>'
      + '<td class="st-num"><code' + klass + '>' + escapeText(row.ratio) + '</code></td></tr>'
  }
  const head = '<tr><th>Example</th><th>Metric</th><th class="st-num">abide</th>'
    + '<th class="st-num">Hand-written</th><th class="st-num">Ratio</th></tr>'
  return '<p class="ex-note">What no page can see about itself. Written by bun run bench; a row it cannot produce is dropped rather than authored.</p>'
    + '<table class="st"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>'
}

function machineryBody(panel, data) {
  let rows = '<tr><td>Code lines</td><td class="st-num"><code>' + data.lines
    + '</code></td><td>across ' + data.files + ' files</td></tr>'
  rows += '<tr><td>Exported names</td><td class="st-num"><code>' + data.names.total
    + '</code></td><td>across ' + Object.keys(data.names.byEntry).length + ' entries</td></tr>'
  for (const entry of Object.keys(data.names.byEntry)) {
    const exported = data.names.byEntry[entry]
    rows += '<tr><td>' + escapeText(entry) + '</td><td class="st-num"><code>' + exported.length
      + '</code></td><td><code>' + escapeText(exported.join(', ') || '\\u2014') + '</code></td></tr>'
  }
  return '<p class="ex-note">Two of the triple. The third \\u2014 branches added to a shared path \\u2014 stays hand-counted.</p>'
    + '<table class="st"><thead><tr><th>What</th><th class="st-num">Count</th><th>Where</th></tr></thead><tbody>'
    + rows + '</tbody></table>'
}

const BODIES = {
  unit: suitesBody, gates: suitesBody, browser: suitesBody,
  ops: opsBody, bench: benchBody, counted: countedBody, machinery: machineryBody,
}

// ----- the shell --------------------------------------------------------------

function verdict(panel) {
  const data = state[panel.id]
  if (!data) return '<span class="ex-tag">not run</span>'
  if (data.error) return '<code class="st-no">' + escapeText(data.error) + '</code>'
  if (panel.kind === 'suites') {
    if (data.unavailable) return '<span class="ex-tag">not run \\u2014 ' + escapeText(data.unavailable) + '</span>'
    const totals = suiteTotals(data.rows)
    if (totals.done === 0)
      return data.rows.length
        ? '<span class="ex-tag">' + data.rows.length + ' suites</span>'
        : '<span class="ex-tag">not run</span>'
    if (totals.failures > 0) return '<code class="st-no">' + totals.failures + ' failing</code>'
    return '<code class="st-ok">' + totals.passing + ' passing</code>'
  }
  if (panel.kind === 'ops') {
    const done = data.rows.filter((row) => row.result)
    if (!done.length) return '<span class="ex-tag">' + data.rows.length + ' operations</span>'
    let slowest = 0
    for (const row of done)
      if (row.result.ratio.kind === 'ratio' && row.result.ratio.value > slowest)
        slowest = row.result.ratio.value
    return '<code>' + done.length + ' of ' + data.rows.length + ', up to ' + slowest.toFixed(1) + 'x</code>'
  }
  if (panel.kind === 'bench') {
    const done = data.rows.filter((row) => row.result)
    if (!done.length) return '<span class="ex-tag">' + data.rows.length + ' cards</span>'
    const refused = done.filter((row) => row.result.refused).length
    return refused
      ? '<code class="st-no">' + refused + ' of ' + done.length + ' refused</code>'
      : '<code class="st-ok">' + done.length + ' of ' + data.rows.length + ' measured</code>'
  }
  return '<code class="st-ok">read</code>'
}

// A PANEL WITH DATA HAS NOT NECESSARILY RUN. The suite tables are drawn from the
// listing on load, so a panel holds state before anything has been executed, and the
// button read "Run again" over a table of twenty-two queued rows.
function hasRun(panel, data) {
  if (!data) return false
  if (panel.kind === 'suites') return suiteTotals(data.rows || []).done > 0
  if (panel.kind === 'ops' || panel.kind === 'bench')
    return (data.rows || []).some((row) => row.result)
  return true
}

function paint() {
  sections.innerHTML = PANELS.map((panel) => {
    const data = state[panel.id]
    const inFlight = state[panel.id + ':running']
    const progress = state[panel.id + ':progress'] || 0
    let body = ''
    if (data && data.error) body = '<p class="st-failure">' + escapeText(data.error) + '</p>'
    else if (data) body = BODIES[panel.id](panel, data)
    else if (!inFlight) body = '<p class="ex-note">Not run yet.' + (panel.slow ? ' Takes ' + panel.slow + '.' : '') + '</p>'
    // THE BAR SITS ABOVE THE TABLE RATHER THAN INSTEAD OF IT. Rows arrive one at a
    // time now, so replacing the body with "Running..." would hide the thing the
    // streaming was built for.
    // inFlight, NOT running. The name running now belongs to the module-level map of
    // in-flight fetches, which is an OBJECT and therefore always truthy — so every
    // panel drew a progress bar and the words "Running... 0%" above its own "Not run
    // yet.". The rename that introduced the map reached the two branches above and
    // not this one, which is what a local shadowed by a new global looks like.
    // THE LABEL RIDES THE BAR. Two lines for one fact, and the second was a
    // paragraph the width of the column saying a number the bar already draws.
    if (inFlight) body = '<div class="st-progress">'
      + '<div class="st-bar"><i style="width:' + progress + '%"></i></div>'
      + '<span class="ex-note">Running' + (panel.slow ? ' \\u2014 this one takes ' + panel.slow : '')
      + '\\u2026 ' + progress + '%</span></div>' + body
    return '<section><div class="head"><h2>' + panel.title + '</h2>'
      + (panel.kind === 'suites' ? suiteNote(panel, data) : '')
      + '<div class="st-actions">' + verdict(panel)
      + (inFlight
          ? '<button type="button" class="st-cancel" data-cancel="' + panel.id + '">Cancel</button>'
          : '<button type="button" data-run="' + panel.id + '">'
            + (hasRun(panel, data) ? 'Run again' : 'Run') + '</button>')
      + '</div></div>' + body + '</section>'
  }).join('')
  document.getElementById('filters').innerHTML = filters()
  // SET, NOT REPLACED. Assigning outerHTML detaches the node, so the reference taken
  // at load pointed at a node no longer in the document and every paint after the
  // first wrote the verdict nowhere.
  const overall = document.getElementById('overall')
  // GREEN IS A VERDICT AND A VERDICT NEEDS THE WHOLE PANEL. Rows land one at a time
  // and any one of them can be run alone, so the header has twice now called a run
  // green on the strength of a fraction of it: once at 4% through the stream, and
  // once off a single suite somebody pressed Run on. Failing is different — one red
  // suite is red whatever else has not run.
  let failing = 0
  let done = 0
  let listed = 0
  for (const panel of PANELS) {
    const data = state[panel.id]
    if (panel.kind !== 'suites' || !data || !data.rows) continue
    const totals = suiteTotals(data.rows)
    // A PANEL NOBODY STARTED IS NOT OUTSTANDING. Every suite panel is listed on load,
    // so counting all of them made "green" mean "you ran the gates too" — and the
    // header then never reached it. The verdict is over what was ASKED for: green is
    // everything you started having finished and passed.
    if (totals.done === 0) continue
    failing += totals.failures
    done += totals.done
    listed += data.rows.length
  }
  const anyRunning = Object.keys(running).length > 0
  document.getElementById('all').textContent = anyRunning ? 'Cancel everything' : 'Run everything'
  if (anyRunning) { overall.className = 'ex-tag'; overall.textContent = 'running\u2026' }
  else if (failing > 0) { overall.className = 'st-no'; overall.textContent = failing + ' failing' }
  else if (done === 0) { overall.className = 'ex-tag'; overall.textContent = 'nothing run yet' }
  else if (done < listed) { overall.className = 'ex-tag'; overall.textContent = done + ' of ' + listed + ' run' }
  else { overall.className = 'st-ok'; overall.textContent = 'green' }
}

// ONE READER FOR EVERY ENDPOINT. All four that produce rows stream NDJSON, so there
// is no second shape to keep in step: a panel that answers in one line is a stream of
// length one.
async function run(panel, only) {
  // A WHOLE RUN OWNS THE PANEL; a single file owns its row. Disabling the panel for a
  // one-file run would hide the twenty-one results it is not touching.
  if (!only) {
    // The listing is KEPT. Deleting it emptied the table for the length of the run,
    // which is the one thing drawing the rows up front was for.
    const held = state[panel.id]
    if (held && held.rows) for (const row of held.rows) { row.state = 'queued'; row.result = null }
    state[panel.id + ':running'] = true
    state[panel.id + ':progress'] = 0
  }
  const stopping = new AbortController()
  running[panel.id + (only || '')] = stopping
  paint()
  const address = only ? panel.endpoint + '?file=' + encodeURIComponent(only) : panel.endpoint
  try {
    const answer = await fetch(address, { method: 'POST', signal: stopping.signal })
    if (!answer.ok) throw new Error(answer.status + ' from ' + panel.endpoint)
    const reader = answer.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      const lines = buffer.split('\\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        const message = JSON.parse(line)
        // The heartbeat. It exists to keep the connection open, so repainting for it
        // would be the one thing it must not cost.
        if (message.kind === 'alive') continue
        accept(panel, message)
        paint()
      }
    }
  } catch (error) {
    // A CANCEL IS NOT AN ERROR. The rows that landed stay, the ones that did not go
    // back to queued, and the panel reports what it has rather than a red message
    // about a run somebody chose to end.
    const cancelled = stopping.signal.aborted
    // THE STACK GOES TO THE CONSOLE. A panel that renders the message alone tells you
    // a TypeError happened and nothing about where — which cost a round trip the one
    // time it mattered.
    if (!cancelled) console.error('status:', panel.id, error)
    if (only) {
      const row = rowFor(panel, only, '')
      if (row) row.state = 'queued'
    } else if (!cancelled) state[panel.id] = { error: String(error) }
  }
  delete running[panel.id + (only || '')]
  if (!only) state[panel.id + ':running'] = false
  const held = state[panel.id]
  if (held && held.rows) for (const row of held.rows) if (row.state === 'running') row.state = 'queued'
  paint()
}

function cancel(panel, only) {
  const stopping = running[panel.id + (only || '')]
  if (stopping) stopping.abort()
}

function accept(panel, message) {
  if (message.error) { state[panel.id] = { error: message.error }; return }
  if (message.kind === 'start') {
    // A SINGLE-FILE RUN MERGES; a whole run clears the results and keeps the table.
    // Replacing the table on either would wipe twenty-one results to re-run one, and
    // deleting it would empty the panel for the length of the run — which is the one
    // thing drawing the rows up front was for.
    const held = state[panel.id]
    if (message.only && held && held.rows) return
    if (held && held.rows) {
      if (message.command) held.command = message.command
      held.seconds = 0
      held.unavailable = message.unavailable || null
      for (const row of held.rows) { row.state = 'queued'; row.result = null }
      return
    }
    state[panel.id] = {
      command: message.command || '',
      rows: (message.files || []).map((label) => ({ label, project: '', state: 'queued', result: null })),
      seconds: 0,
      unavailable: message.unavailable || null,
    }
    return
  }
  if (message.kind === 'running') {
    const row = rowFor(panel, message.file, '')
    if (row) row.state = 'running'
    return
  }
  // THREE RESULT KINDS, ONE ROW MODEL. A suite, a per-operation ratio and a measured
  // card are different records in the same table shape — so what varies is which
  // field names the row, and the merge is written once.
  const landed = message.kind === 'suite'
    ? { label: message.suite.file, project: message.suite.project || '', result: message.suite }
    : message.kind === 'op'
      ? { label: message.row.case, project: '', result: message.row }
      : message.kind === 'card'
        ? { label: message.card.example, project: message.card.page || '', result: message.card }
        : null
  if (landed) {
    const row = rowFor(panel, landed.label, landed.project)
    if (row) { row.state = 'done'; row.result = landed.result }
    // A row the listing did not name. Playwright learns its own file names from a
    // report, so this is how a spec added since the page loaded arrives.
    else if (state[panel.id] && state[panel.id].rows)
      state[panel.id].rows.push({ ...landed, state: 'done' })
    if (message.total)
      state[panel.id + ':progress'] = Math.round((message.done / message.total) * 100)
    return
  }
  if (message.kind === 'done') {
    const held = state[panel.id]
    if (held && held.rows) {
      held.seconds = message.seconds || held.seconds
      // A row left running is a file whose process produced nothing at all.
      for (const row of held.rows) if (row.state === 'running') row.state = 'queued'
    }
    return
  }
  if (message.kind === 'value') state[panel.id] = message.value
}

function rowFor(panel, label, project) {
  const held = state[panel.id]
  if (!held || !held.rows) return null
  for (const row of held.rows)
    if (row.label === label && (row.project || '') === (project || '')) return row
  return null
}

document.addEventListener('click', (event) => {
  // THE ROW BUTTON IS CHECKED FIRST and stops there: it sits inside a row that toggles
  // on click, so running one suite would otherwise also open it.
  const one = event.target.closest('[data-one]')
  if (one) {
    const panel = PANELS.find((entry) => entry.id === one.dataset.one)
    const row = rowFor(panel, one.dataset.file, '')
    if (row) row.state = 'running'
    paint()
    run(panel, one.dataset.file)
    return
  }
  const chosen = event.target.closest('[data-package]')
  if (chosen) {
    filter = chosen.dataset.package
    paint()
    return
  }
  const rowStopper = event.target.closest('[data-stop]')
  if (rowStopper) {
    cancel(PANELS.find((entry) => entry.id === rowStopper.dataset.stop), rowStopper.dataset.file)
    return
  }
  const stopper = event.target.closest('[data-cancel]')
  if (stopper) { cancel(PANELS.find((panel) => panel.id === stopper.dataset.cancel)); return }
  const runner = event.target.closest('[data-run]')
  if (runner) { run(PANELS.find((panel) => panel.id === runner.dataset.run)); return }
  const row = event.target.closest('[data-open]')
  if (!row) return
  const id = row.dataset.open
  open[id] = !open[id]
  paint()
})
document.getElementById('all').addEventListener('click', async () => {
  // The same button both ways: it starts everything, and while anything is in flight
  // it stops everything. A separate cancel that only appears sometimes is a control
  // whose position moves.
  if (Object.keys(running).length) {
    for (const key of Object.keys(running)) running[key].abort()
    return
  }
  for (const panel of PANELS) await run(panel)
})

// THE TABLE BEFORE THE RUN. One read, no processes started, so the page opens on the
// shape of every suite rather than on six headings and the word "no". A panel whose
// listing fails still has its button.
async function listSuites() {
  try {
    const answer = await fetch('/api/suites', { method: 'POST' })
    // EVERY LINE, NOT THE FIRST. The listing spawns a child and reads a config, and
    // the moment it outlasts one heartbeat the first line is an 'alive' with no
    // 'value' on it — which read as a listing that failed and left every table empty
    // with nothing said anywhere.
    let listing = null
    for (const line of (await answer.text()).split('\\n')) {
      if (!line.trim()) continue
      const message = JSON.parse(line)
      if (message.value) listing = message.value
    }
    for (const panel of PANELS) {
      const entry = listing && listing[panel.id]
      if (!entry) continue
      state[panel.id] = {
        command: entry.command,
        rows: entry.rows.map((one) => ({
          label: one.label,
          project: one.project || '',
          state: 'queued',
          result: null,
        })),
        seconds: 0,
        unavailable: null,
      }
    }
  } catch (error) {
    // Not an error the page reports: the buttons still work and each one sends its
    // own list. A listing that failed is a table that fills late, not a broken panel.
  }
  paint()
}

paint()
listSuites()
`
