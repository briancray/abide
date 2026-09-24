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
  { id: 'machinery', title: 'Machinery', endpoint: '/api/machinery' },
]

const state = {}

function escapeText(value) {
  return String(value).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}
function table(head, rows) {
  return '<table class="st-table"><thead><tr>' + head.map((h) => '<th>' + h + '</th>').join('')
    + '</tr></thead><tbody>' + rows + '</tbody></table>'
}

function suiteBody(run) {
  if (!run.ran) return '<p class="st-note">Not run \\u2014 ' + escapeText(run.unavailable) + '</p>'
  let rows = ''
  for (const suite of run.suites) {
    const bad = suite.failures > 0
    rows += '<tr><td>' + escapeText(suite.file) + '</td><td><code' + (bad ? ' class="st-bad"' : '') + '>'
      + (suite.tests - suite.failures) + '/' + suite.tests + '</code></td><td>'
      + (suite.skipped ? '<code>' + suite.skipped + '</code>' : '') + '</td></tr>'
    for (const one of suite.cases) {
      if (!one.failure) continue
      rows += '<tr><td colspan="3"><p class="failure"><strong>' + escapeText(one.name) + '</strong>\\n'
        + escapeText(one.failure) + '</p></td></tr>'
    }
  }
  return '<p class="st-note"><code>' + escapeText(run.command) + '</code> \\u00b7 '
    + run.seconds.toFixed(1) + ' s</p>' + table(['Suite', 'Passing', 'Skipped'], rows)
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
  return '<p class="st-note">Two of the triple. The third \\u2014 branches added to a shared path \\u2014 stays hand-counted.</p>'
    + table(['What', 'Count', 'Where'], rows)
}

const BODIES = { unit: suiteBody, gates: suiteBody, browser: suiteBody, machinery: machineryBody }

function verdict(panel) {
  const data = state[panel.id]
  if (!data) return '<span class="st-tag">not run</span>'
  if (data.error) return '<code class="st-bad">' + escapeText(data.error) + '</code>'
  if (data.suites) {
    if (!data.ran) return '<span class="st-tag">not run \\u2014 ' + escapeText(data.unavailable) + '</span>'
    return data.failures > 0
      ? '<code class="st-bad">' + data.failures + ' failing</code>'
      : '<code class="st-good">' + data.tests + ' passing</code>'
  }
  return '<code class="st-good">read</code>'
}

function paint() {
  sections.innerHTML = PANELS.map((panel) => {
    const data = state[panel.id]
    const running = state[panel.id + ':running']
    let body = ''
    if (running) body = '<p class="st-note">Running\\u2026</p>'
    else if (data && data.error) body = '<p class="failure">' + escapeText(data.error) + '</p>'
    else if (data) body = BODIES[panel.id](data)
    else body = '<p class="st-note">Not run yet.</p>'
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
  overall.className = suites.length === 0 ? 'st-tag' : failing > 0 ? 'st-bad' : 'st-good'
  overall.textContent = suites.length === 0
    ? 'nothing run yet'
    : failing > 0 ? failing + ' failing' : 'green'
}

async function run(panel) {
  state[panel.id + ':running'] = true
  delete state[panel.id]
  paint()
  try {
    const answer = await fetch(panel.endpoint, { method: 'POST' })
    state[panel.id] = await answer.json()
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
