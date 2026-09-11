// THE STATUS PAGE'S OWN SCRIPT, served as a file rather than inlined. An inline
// script inside a template literal inside a template literal is the seam four
// escaping bugs shipped through while the example panel was being written; a
// separate file has one layer of quoting and the browser reports its own syntax
// errors.
//
// A leaf — no imports of its own.
export const STATUS_SCRIPT = `
const sections = document.getElementById('sections')

// ONE ROW PER THING THAT CAN BE RUN. Each is its own endpoint and its own button, so
// a slow one never blocks a fast one and a red one never hides the rest.
const PANELS = [
  { id: 'unit', title: 'Unit and docs', endpoint: '/api/run/unit' },
  { id: 'gates', title: 'Gates, with every revert run', endpoint: '/api/run/gates' },
  { id: 'browser', title: 'Browser, chromium and webkit', endpoint: '/api/run/browser' },
  { id: 'counted', title: 'Counted over the source', endpoint: '/api/counted' },
  { id: 'machinery', title: 'Machinery', endpoint: '/api/machinery' },
  { id: 'measure', title: 'Measured in a browser', endpoint: '/api/measure', streams: true, slow: 'a few minutes' },
]

const state = {}

function escapeText(value) {
  return String(value).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}
function micro(nanoseconds) {
  if (nanoseconds >= 1e6) return (nanoseconds / 1e6).toFixed(2) + ' ms'
  if (nanoseconds >= 1e3) return (nanoseconds / 1e3).toFixed(2) + ' \\u00b5s'
  return Math.round(nanoseconds) + ' ns'
}
function table(head, rows) {
  return '<table class="ex-bench"><thead><tr>' + head.map((h) => '<th>' + h + '</th>').join('')
    + '</tr></thead><tbody>' + rows + '</tbody></table>'
}

function suiteBody(run) {
  if (!run.ran) return '<p class="ex-note">Not run \\u2014 ' + escapeText(run.unavailable) + '</p>'
  let rows = ''
  for (const suite of run.suites) {
    const bad = suite.failures > 0
    rows += '<tr><td>' + escapeText(suite.file) + '</td><td><code' + (bad ? ' class="ex-bad"' : '') + '>'
      + (suite.tests - suite.failures) + '/' + suite.tests + '</code></td><td>'
      + (suite.skipped ? '<code>' + suite.skipped + '</code>' : '') + '</td></tr>'
    for (const one of suite.cases) {
      if (!one.failure) continue
      rows += '<tr><td colspan="3"><p class="failure"><strong>' + escapeText(one.name) + '</strong>\\n'
        + escapeText(one.failure) + '</p></td></tr>'
    }
  }
  return '<p class="ex-note"><code>' + escapeText(run.command) + '</code> \\u00b7 '
    + run.seconds.toFixed(1) + ' s</p>' + table(['Suite', 'Passing', 'Skipped'], rows)
}

function countedBody(data) {
  if (!data.rows.length) return '<p class="ex-note">No example carries a counted row yet.</p>'
  let rows = ''
  for (const row of data.rows) {
    const value = Number.parseFloat(row.ratio)
    const klass = !Number.isFinite(value) || value === 1 ? '' : value < 1 ? ' class="ex-good"' : ' class="ex-bad"'
    rows += '<tr><td>' + escapeText(row.example) + '</td><td>' + escapeText(row.metric) + '</td><td><code>'
      + escapeText(row.abide) + '</code></td><td><code>' + escapeText(row.vanilla) + '</code></td>'
      + '<td class="ex-ratio"><code' + klass + '>' + escapeText(row.ratio) + '</code></td></tr>'
  }
  return '<p class="ex-note">What no page can see about itself. Written by bun run bench; a row it cannot produce is dropped rather than authored.</p>'
    + table(['Example', 'Metric', 'abide', 'Hand-written', 'Ratio'], rows)
}

function machineryBody(data) {
  let rows = '<tr><td>Code lines</td><td><code>' + data.lines + '</code></td><td>across ' + data.files + ' files</td></tr>'
  rows += '<tr><td>Exported names</td><td><code>' + data.names.total + '</code></td><td>across '
    + Object.keys(data.names.byEntry).length + ' entries</td></tr>'
  for (const entry of Object.keys(data.names.byEntry)) {
    const exported = data.names.byEntry[entry]
    rows += '<tr><td>' + escapeText(entry) + '</td><td><code>' + exported.length + '</code></td><td><code>'
      + escapeText(exported.join(', ') || '\\u2014') + '</code></td></tr>'
  }
  return '<p class="ex-note">Two of the triple. The third \\u2014 branches added to a shared path \\u2014 stays hand-counted.</p>'
    + table(['What', 'Count', 'Where'], rows)
}

function measureBody(cards) {
  let rows = ''
  const paints = []
  for (const card of cards) {
    if (card.refused) {
      rows += '<tr><td>' + escapeText(card.example) + '</td><td colspan="5"><span class="ex-tag">'
        + escapeText(card.refused) + '</span></td></tr>'
      continue
    }
    if (card.firstPaintMilliseconds !== null) paints.push(card.firstPaintMilliseconds.toFixed(1))
    rows += '<tr><td>' + escapeText(card.example) + '</td><td><code>' + escapeText(card.counts || '\\u2014')
      + '</code></td><td><code>' + card.nodes + '</code></td><td><code>'
      + (card.firstPaintMilliseconds === null ? '\\u2014' : card.firstPaintMilliseconds.toFixed(1) + ' ms')
      + '</code></td><td><code>' + (card.nanosecondsPerOp === null ? '\\u2014' : micro(card.nanosecondsPerOp))
      + '</code></td><td><code>' + escapeText(card.sample || '\\u2014') + '</code></td></tr>'
  }
  // A COLUMN THAT DOES NOT DISTINGUISH IS REPORTING THE INSTRUMENT. First paint came
  // back as exactly 20.0 ms on 60 of 69 cards, which is the browser's coarsened paint
  // clock rather than 60 examples that cost the same.
  const seen = {}
  for (const value of paints) seen[value] = (seen[value] || 0) + 1
  let commonest = ['', 0]
  for (const key of Object.keys(seen)) if (seen[key] > commonest[1]) commonest = [key, seen[key]]
  const warning = paints.length >= 5 && commonest[1] / paints.length > 0.5
    ? ' <span class="ex-tag">first paint read ' + commonest[0] + ' ms on ' + commonest[1] + ' of '
      + paints.length + ' cards \\u2014 that is the browser\\'s paint clock, not the examples</span>'
    : ''
  return '<p class="ex-note">Chromium, driven over the same panel a reader drives. Counts are the same in every engine; the timings are this machine\\'s.'
    + warning + '</p>'
    + table(['Example', 'On load', 'Nodes', 'First paint', 'Per op', 'Sample'], rows)
}

const BODIES = { unit: suiteBody, gates: suiteBody, browser: suiteBody, counted: countedBody, machinery: machineryBody, measure: measureBody }

function verdict(panel) {
  const data = state[panel.id]
  if (!data) return '<span class="ex-tag">not run</span>'
  if (data.error) return '<code class="ex-bad">' + escapeText(data.error) + '</code>'
  if (data.suites) {
    if (!data.ran) return '<span class="ex-tag">not run \\u2014 ' + escapeText(data.unavailable) + '</span>'
    return data.failures > 0
      ? '<code class="ex-bad">' + data.failures + ' failing</code>'
      : '<code class="ex-good">' + data.tests + ' passing</code>'
  }
  if (Array.isArray(data)) {
    const refused = data.filter((card) => card.refused).length
    return refused
      ? '<code class="ex-bad">' + refused + ' of ' + data.length + ' refused</code>'
      : '<code class="ex-good">' + data.length + ' measured</code>'
  }
  return '<code class="ex-good">read</code>'
}

function paint() {
  sections.innerHTML = PANELS.map((panel) => {
    const data = state[panel.id]
    const running = state[panel.id + ':running']
    const progress = state[panel.id + ':progress']
    let body = ''
    if (running) body = '<div class="bar"><i style="width:' + (progress || 0) + '%"></i></div>'
      + '<p class="ex-note">Running' + (panel.slow ? ' \\u2014 this one takes ' + panel.slow : '') + '\\u2026</p>'
    else if (data && data.error) body = '<p class="failure">' + escapeText(data.error) + '</p>'
    else if (data) body = BODIES[panel.id](data)
    else body = '<p class="ex-note">Not run yet.' + (panel.slow ? ' Takes ' + panel.slow + '.' : '') + '</p>'
    return '<section><div class="head"><h2>' + panel.title + '</h2>' + verdict(panel)
      + '<button type="button" data-run="' + panel.id + '"' + (running ? ' disabled' : '') + '>'
      + (data ? 'Run again' : 'Run') + '</button></div>' + body + '</section>'
  }).join('')
  // SET, NOT REPLACED. Assigning outerHTML detaches the node, so the reference taken
  // at load pointed at a node no longer in the document and every paint after the
  // first wrote the verdict nowhere.
  const overall = document.getElementById('overall')
  const suites = PANELS.filter((panel) => state[panel.id] && state[panel.id].suites)
  const failing = suites.reduce((total, panel) => total + state[panel.id].failures, 0)
  overall.className = suites.length === 0 ? 'ex-tag' : failing > 0 ? 'ex-bad' : 'ex-good'
  overall.textContent = suites.length === 0
    ? 'nothing run yet'
    : failing > 0 ? failing + ' failing' : 'green'
}

async function run(panel) {
  state[panel.id + ':running'] = true
  state[panel.id + ':progress'] = 0
  delete state[panel.id]
  paint()
  try {
    if (!panel.streams) {
      const answer = await fetch(panel.endpoint, { method: 'POST' })
      state[panel.id] = await answer.json()
    } else {
      // NDJSON, one line per card, so a pass measured in minutes fills the table as
      // it goes rather than after.
      const answer = await fetch(panel.endpoint, { method: 'POST' })
      const reader = answer.body.getReader()
      const decoder = new TextDecoder()
      const cards = []
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
          if (message.error) { state[panel.id] = { error: message.error }; break }
          cards.push(message.card)
          state[panel.id + ':progress'] = Math.round((message.done / message.total) * 100)
          state[panel.id] = cards.slice()
          state[panel.id + ':running'] = true
          paint()
        }
      }
      if (!state[panel.id]) state[panel.id] = cards
    }
  } catch (error) {
    state[panel.id] = { error: String(error) }
  }
  state[panel.id + ':running'] = false
  paint()
}

document.addEventListener('click', (event) => {
  const id = event.target.closest('[data-run]')?.dataset.run
  if (id) run(PANELS.find((panel) => panel.id === id))
})
document.getElementById('all').addEventListener('click', async () => {
  for (const panel of PANELS) await run(panel)
})
paint()
`
