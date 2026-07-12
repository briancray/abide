/*
The inspector UI as one self-contained HTML document — no app bundle, no build
step, so the page renders standalone whatever the host app's toolchain. Data
paths are derived from location.pathname (root + `/surface` + `/events`) so the
page works under any mount and inherits any APP_URL base transparently.

Tabs: Logs (the live tail, default), Traces (records grouped by trace id with a
span waterfall), In-flight (handlers executing now, polled), Reactive + Router
(the app tab's scope tree + routing, over a same-origin BroadcastChannel),
Cache (the shared store, polled), and Surface (the static catalog). The
stream-fed tabs build client-side from the buffered records, so filters and the
waterfall need no extra round-trips; the polled tabs snapshot on open and via a
refresh button; the channel tabs render whatever the app side publishes. Log
rows and trace headers carry a wall-clock timestamp from each record's `ts`.
Styling is inline (devtools-dark) — it can't reach the app's Tailwind from here.
*/
export function inspectorHtml(appName: string, appVersion: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(appName)} · abide inspector</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; height: 100vh; display: flex; flex-direction: column; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: #0c0d10; color: #d7dae0; }
  header { flex: none; display: flex; align-items: baseline; gap: 12px; padding: 10px 16px; border-bottom: 1px solid #1d2026; }
  header b { font-size: 14px; color: #fff; }
  header span { color: #6b7280; }
  header .warn { margin-left: auto; color: #d9a441; font-size: 11px; }
  nav { flex: none; display: flex; gap: 2px; padding: 0 12px; border-bottom: 1px solid #1d2026; }
  nav button { background: none; border: none; border-bottom: 2px solid transparent; color: #6b7280; padding: 8px 12px; cursor: pointer; font: inherit; }
  nav button.active { color: #fff; border-bottom-color: #5b8def; }
  nav .count { color: #4b5563; font-size: 11px; }
  /* Marks tabs sourced from this browser's app tabs (BroadcastChannel), not the
     server's global traffic — disambiguates local-session state from everyone's. */
  nav .local { color: #4aa3a3; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; vertical-align: 2px; }
  main { flex: 1; min-height: 0; }
  .panel { display: none; height: 100%; overflow: auto; }
  .panel.active { display: block; }

  .filters { position: sticky; top: 0; z-index: 1; display: flex; gap: 8px; align-items: center; padding: 8px 16px; background: #0c0d10; border-bottom: 1px solid #1d2026; }
  .filters select, .filters input { background: #14161b; border: 1px solid #1d2026; color: #d7dae0; border-radius: 4px; padding: 4px 8px; font: inherit; }
  .filters input { flex: 1; min-width: 60px; }
  .filters .pill { color: #6b7280; font-size: 11px; }
  .filters button { background: #14161b; border: 1px solid #1d2026; color: #9aa0aa; border-radius: 4px; padding: 4px 8px; cursor: pointer; font: inherit; }

  .row { display: flex; gap: 10px; align-items: baseline; padding: 3px 16px; border-bottom: 1px solid #14161b; font-variant-numeric: tabular-nums; }
  .row:hover { background: #111317; }
  .row.block { align-items: flex-start; }
  .time { flex: none; width: 92px; color: #4b5563; }
  .trace { flex: none; width: 64px; color: #5b8def; cursor: pointer; }
  .trace:hover { text-decoration: underline; }
  .body { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row.block .body { overflow: visible; white-space: normal; text-overflow: clip; }
  .body pre.msg { margin: 0; font: inherit; white-space: pre; overflow-x: auto; }
  .meta { flex: none; display: flex; gap: 8px; align-items: baseline; }
  .channel { color: #6b7280; }
  .sock { color: #b48ead; }
  .payload { color: #6b7280; }
  .method { font-weight: 700; }
  .method.GET { color: #5fb87a; } .method.POST { color: #5b8def; } .method.PUT, .method.PATCH { color: #d9a441; } .method.DELETE { color: #d96a6a; } .method.HEAD { color: #9aa0aa; }
  .status.s2 { color: #5fb87a; } .status.s3 { color: #56b6c2; } .status.s4 { color: #d9a441; } .status.s5 { color: #d96a6a; }
  .ms { color: #6b7280; }
  .cache { color: #56b6c2; font-size: 11px; }
  .lvl-error .body { color: #d96a6a; } .lvl-warn .body { color: #d9a441; }

  .twrap { padding: 8px 16px; border-bottom: 1px solid #1d2026; }
  .thead { display: flex; gap: 12px; align-items: baseline; cursor: pointer; }
  .thead:hover { color: #fff; }
  .tid { flex: none; width: 72px; color: #5b8def; }
  .tpath { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ttime { flex: none; color: #4b5563; font-variant-numeric: tabular-nums; }
  .span { display: grid; grid-template-columns: 220px 1fr; gap: 10px; align-items: center; margin-top: 4px; }
  .slabel { display: flex; gap: 6px; align-items: baseline; overflow: hidden; font-size: 12px; }
  .sname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #9aa0aa; }
  .sdur { flex: none; margin-left: auto; color: #6b7280; }
  .track { position: relative; height: 14px; background: #07080a; border-radius: 3px; }
  .bar { position: absolute; top: 0; height: 100%; background: #3b5da8; border-radius: 3px; min-width: 2px; }
  .bar.req { background: #2d3b57; }
  .qhead { display: flex; gap: 10px; align-items: baseline; margin-top: 8px; }
  .qpath { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #d7dae0; }

  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; margin: 16px 16px 8px; }
  table.surface { width: calc(100% - 32px); margin: 0 16px 16px; border-collapse: collapse; }
  table.surface th { text-align: left; font-weight: normal; color: #4b5563; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; padding: 4px 10px; border-bottom: 1px solid #1d2026; }
  table.surface td { padding: 4px 10px; border-bottom: 1px solid #14161b; white-space: nowrap; }
  table.surface th.c, table.surface td.c { text-align: center; }
  table.surface th.num, table.surface td.num { text-align: right; }
  tr.vrow { cursor: pointer; }
  tr.vrow:hover td { background: #111317; }
  td.url { color: #d7dae0; width: 99%; }
  .glyph.on { color: #5fb87a; } .glyph.off { color: #2b2f38; }
  .num { color: #9aa0aa; font-variant-numeric: tabular-nums; }
  tr.vdetail > td { background: #07080a; white-space: normal; }
  tr.vdetail dl { display: grid; grid-template-columns: auto 1fr; gap: 1px 14px; margin: 4px 0 8px; max-width: 520px; }
  tr.vdetail dt { color: #6b7280; } tr.vdetail dd { margin: 0; color: #9aa0aa; }
  pre.schema { margin: 6px 0 0; padding: 8px; background: #0c0d10; border-radius: 4px; overflow: auto; color: #9aa0aa; white-space: pre; }
  .cval { max-width: 380px; overflow: hidden; text-overflow: ellipsis; color: #9aa0aa; }
  .cstat.settled { color: #5fb87a; } .cstat.in-flight { color: #d9a441; } .cstat.refreshing { color: #56b6c2; }
  .empty { color: #4b5563; padding: 16px; }

  .scope { border-bottom: 1px solid #14161b; }
  .scope > .shead { display: flex; gap: 8px; align-items: baseline; padding: 6px 16px; }
  .sid { color: #5b8def; }
  .slbl { color: #5fb87a; }
  .srec { color: #b48ead; font-size: 11px; }
  .scope pre.json { margin: 0; padding: 2px 16px 8px; color: #9aa0aa; white-space: pre-wrap; word-break: break-word; }
  .scope pre.json .k { color: #56b6c2; }
  .scope.flash > .shead .sid { color: #5fb87a; }
  dl.router { display: grid; grid-template-columns: auto 1fr; gap: 2px 16px; margin: 16px; max-width: 640px; }
  dl.router dt { color: #6b7280; } dl.router dd { margin: 0; color: #d7dae0; word-break: break-all; }
</style>
</head>
<body>
<header>
  <b>${escapeHtml(appName)}</b><span>${escapeHtml(appVersion)}</span><span>abide inspector</span>
  <span class="warn">privileged · exposes all traffic</span>
</header>
<nav>
  <button data-tab="logs" class="active">Logs <span class="count" id="logsCount"></span></button>
  <button data-tab="traces">Traces <span class="count" id="tracesCount"></span></button>
  <button data-tab="inflight">In-flight <span class="count" id="inflightCount"></span></button>
  <button data-tab="cache">Cache <span class="count" id="cacheCount"></span></button>
  <button data-tab="surface">Surface</button>
  <button data-tab="reactive">Reactive <span class="count" id="reactiveCount"></span><span class="local" title="this browser's app tabs only — not global traffic">local</span></button>
  <button data-tab="router">Router <span class="local" title="this browser's app tabs only — not global traffic">local</span></button>
</nav>
<main>
  <section class="panel active" data-tab="logs">
    <div class="filters">
      <select id="fChannel"><option value="">all channels</option></select>
      <input id="fTrace" placeholder="trace id…" />
      <input id="fText" placeholder="filter text…" />
      <span class="pill" id="fCount"></span>
      <button id="fClear">clear</button>
    </div>
    <div id="feed"><div class="empty">waiting for activity…</div></div>
  </section>
  <section class="panel" data-tab="traces"><div id="traces"><div class="empty">no traces yet…</div></div></section>
  <section class="panel" data-tab="inflight"><div id="inflight" class="empty">loading in-flight…</div></section>
  <section class="panel" data-tab="cache"><div id="cache" class="empty">loading cache…</div></section>
  <section class="panel" data-tab="surface"><div id="surface" class="empty">loading surface…</div></section>
  <section class="panel" data-tab="reactive">
    <div class="filters">
      <select id="rTab"><option value="">no app tab connected</option></select>
      <span class="pill" id="rPatch"></span>
      <button id="rRefresh">refresh</button>
    </div>
    <div id="reactive" class="empty">open a page of this app in another tab (same browser) — its scope tree appears here</div>
  </section>
  <section class="panel" data-tab="router"><div id="router" class="empty">open a page of this app in another tab (same browser) — its router state appears here</div></section>
</main>
<script type="module">
const root = location.pathname.replace(/\\/$/, '')
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const stripAnsi = (s) => String(s).replace(/\\u001b\\[[0-9;]*m/g, '')
// Local wall-clock HH:MM:SS.mmm from a record's epoch ts (every record carries one).
const pad = (n, w) => String(n).padStart(w, '0')
const fmtClock = (ts) => {
  if (!ts) return ''
  const d = new Date(ts)
  return pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2) + '.' + pad(d.getMilliseconds(), 3)
}

// ---- state ----
const RECORD_CAP = 4000
const ROW_CAP = 800
const records = []
const filters = { channel: '', trace: '', text: '' }
let activeTab = 'logs'

const feedEl = document.getElementById('feed')
const tracesEl = document.getElementById('traces')
const channelSel = document.getElementById('fChannel')
const seenChannels = new Set()

// The pseudo-channel a record filters under: its own channel, or 'request' for
// a closing request record, so requests are selectable alongside log channels.
const channelOf = (r) => r.channel || (r.status !== undefined ? 'request' : 'app')

function matches(r) {
  if (filters.channel && channelOf(r) !== filters.channel) return false
  if (filters.trace && !(r.trace || '').includes(filters.trace)) return false
  if (filters.text) {
    const hay = (r.msg || '') + ' ' + (r.name || '') + ' ' + (r.path || '') + ' ' + (r.method || '') + ' ' + (r.data ? JSON.stringify(r.data) : '')
    if (!hay.toLowerCase().includes(filters.text.toLowerCase())) return false
  }
  return true
}

// ---- log rows ----
function rowEl(r) {
  const ms = r.elapsedMs ?? r.durationMs
  const isRequest = r.status !== undefined
  const isSocket = r.channel === 'socket'
  let body
  let block = false
  if (isRequest) {
    body = '<span class="method ' + esc(r.method || '') + '">' + esc(r.method || '') + '</span> ' + esc(r.path || '')
  } else if (isSocket) {
    const payload = r.data !== undefined ? JSON.stringify(r.data) : ''
    body = '<span class="sock">socket ' + esc(r.msg) + '</span> <span class="payload">' + esc(payload.slice(0, 120)) + '</span>'
  } else {
    block = true
    const tag = r.channel ? '<span class="channel">[' + esc(r.channel) + ']</span> ' : ''
    // Span records (rpcLog.trace et al.) carry their text in 'name', not 'msg'.
    const text = r.msg || r.name || ''
    const extra = r.data !== undefined ? ' ' + JSON.stringify(r.data) : ''
    body = '<pre class="msg">' + tag + esc(stripAnsi(text) + extra) + '</pre>'
  }
  const cache = r.cache && (r.cache.hits + r.cache.misses + r.cache.coalesced) > 0
    ? '<span class="cache" title="cache hits/misses/coalesced">⚡ ' + r.cache.hits + '/' + r.cache.misses + '/' + r.cache.coalesced + '</span>'
    : ''
  const meta =
    (isRequest ? '<span class="status s' + String(r.status)[0] + '">' + esc(r.status) + '</span>' : '') +
    cache +
    (ms !== undefined ? '<span class="ms">+' + ms.toFixed(1) + 'ms</span>' : '')
  const row = document.createElement('div')
  row.className = 'row lvl-' + (r.level || 'info') + (block ? ' block' : '')
  row.innerHTML =
    '<span class="time">' + esc(fmtClock(r.ts)) + '</span>' +
    '<span class="trace" data-trace="' + esc(r.trace || '') + '">' + esc((r.trace || '').slice(0, 8)) + '</span>' +
    '<span class="body">' + body + '</span>' +
    '<span class="meta">' + meta + '</span>'
  return row
}

function appendRow(r) {
  const scroller = document.querySelector('.panel[data-tab=logs]')
  const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40
  feedEl.append(rowEl(r))
  while (feedEl.childElementCount > ROW_CAP) feedEl.firstElementChild.remove()
  if (atBottom) scroller.scrollTop = scroller.scrollHeight
}

function renderLogs() {
  feedEl.innerHTML = ''
  const shown = records.filter(matches)
  for (const r of shown.slice(-ROW_CAP)) feedEl.append(rowEl(r))
  document.getElementById('fCount').textContent = shown.length + ' / ' + records.length
  const scroller = document.querySelector('.panel[data-tab=logs]')
  scroller.scrollTop = scroller.scrollHeight
}

// ---- traces / waterfall ----
// A propagated trace holds many requests (a page session: the SSR render plus
// every RPC its interactions fired). Each request restarts elapsedMs at 0, so
// they can't share one axis — split a trace by request span, give each its own
// lane/axis, and nest by parent span (interactions descend from the page load).
function renderTraces() {
  const byTrace = new Map()
  for (const r of records) {
    if (!r.trace) continue
    if (!byTrace.has(r.trace)) byTrace.set(r.trace, [])
    byTrace.get(r.trace).push(r)
  }
  document.getElementById('tracesCount').textContent = byTrace.size || ''
  if (byTrace.size === 0) { tracesEl.innerHTML = '<div class="empty">no traces yet…</div>'; return }
  // Newest traces first, by the latest record's timestamp.
  const order = [...byTrace.entries()].sort((a, b) => last(b[1]).ts - last(a[1]).ts).slice(0, 200)
  tracesEl.innerHTML = order.map(([id, recs]) => traceHtml(id, recs)).join('')
}
const last = (a) => a[a.length - 1]

// One bar on a request's own 0..total axis. Name truncates; duration is its own
// column so it's never ellipsis'd off the end.
function spanBar(start, dur, total, cls, name) {
  return '<div class="span"><span class="slabel"><span class="sname">' + esc(name) +
    '</span><span class="sdur">' + dur.toFixed(1) + 'ms</span></span>' +
    '<div class="track"><div class="bar ' + cls + '" style="left:' + (start / total * 100) +
    '%;width:' + Math.max(dur / total * 100, 0.4) + '%"></div></div></div>'
}

// Reduce the records sharing a request span into one request: its root timing
// (the closing record) plus its operation spans, each placed on the request's
// own axis (elapsedMs is request-relative, so this is correct per request).
function buildRequest(span, recs) {
  const closing = recs.find((r) => r.status !== undefined)
  const total = Math.max(closing ? closing.durationMs : 0, ...recs.map((r) => r.elapsedMs || 0), 1)
  const spans = recs
    .filter((r) => r.name && r.durationMs !== undefined)
    .map((r) => ({ name: r.name, start: (r.elapsedMs ?? r.durationMs) - r.durationMs, dur: r.durationMs }))
    .sort((a, b) => a.start - b.start)
  return {
    span,
    parent: recs[0] && recs[0].parentSpan,
    ts: recs[0] ? recs[0].ts : 0,
    method: (closing && closing.method) || (recs[0] && recs[0].method),
    path: (closing && closing.path) || (recs[0] && recs[0].path),
    status: closing ? closing.status : undefined,
    cache: closing ? closing.cache : undefined,
    total,
    spans,
  }
}

// The request's cache tally as a badge (⚡ hits/misses/coalesced), or empty when
// the request read nothing cached. Same shape/label as the Logs-row badge.
function cacheBadge(cache) {
  if (!cache || cache.hits + cache.misses + cache.coalesced === 0) return ''
  return '<span class="cache" title="cache hits/misses/coalesced">⚡ ' +
    cache.hits + '/' + cache.misses + '/' + cache.coalesced + '</span>'
}

function traceHtml(id, recs) {
  const byReq = new Map()
  for (const r of recs) {
    const span = r.requestSpan || 'none'
    if (!byReq.has(span)) byReq.set(span, [])
    byReq.get(span).push(r)
  }
  const requests = [...byReq.entries()].map(([span, rs]) => buildRequest(span, rs))
  const known = new Set(requests.map((q) => q.span))
  // Root = the request abide started the trace at (no parent); else the earliest.
  const byTs = [...requests].sort((a, b) => a.ts - b.ts)
  const root = byTs.find((q) => q.parent === undefined) || byTs[0]
  // A request nests under its parent when that parent is itself a request in this
  // trace (server→server); otherwise it descends from a client span we never saw,
  // so it hangs under the journey root (the page load). Grouped once here so the
  // recursive render is O(requests), not O(requests²) per trace.
  const childrenByParent = new Map()
  for (const q of requests) {
    if (q === root) continue
    const parent = known.has(q.parent) ? q.parent : root.span
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, [])
    childrenByParent.get(parent).push(q)
  }
  const childrenOf = (span) => childrenByParent.get(span) ?? []
  const totalSpans = requests.reduce((n, q) => n + q.spans.length, 0)
  const head =
    '<div class="thead">' +
    '<span class="tid">' + esc(id.slice(0, 8)) + '</span>' +
    '<span class="tpath">trace · ' + requests.length + ' request' + (requests.length === 1 ? '' : 's') + '</span>' +
    '<span class="ttime">' + esc(fmtClock(root.ts)) + '</span>' +
    '<span class="channel">' + totalSpans + ' spans</span>' +
    '</div>'
  return '<div class="twrap">' + head + requestHtml(root, childrenOf, 0) + '</div>'
}

// One request lane (its own axis) + operation spans, then its child requests indented.
function requestHtml(q, childrenOf, depth) {
  if (!q || depth > 8) return ''
  const pad = 'style="padding-left:' + depth * 16 + 'px"'
  const header =
    '<div class="qhead" ' + pad + '>' +
    '<span class="method ' + esc(q.method || '') + '">' + esc(q.method || '') + '</span>' +
    '<span class="qpath">' + esc(q.path || q.span.slice(0, 8)) + '</span>' +
    (q.status !== undefined ? '<span class="status s' + String(q.status)[0] + '">' + q.status + '</span>' : '<span class="ms">…</span>') +
    cacheBadge(q.cache) +
    '<span class="ms">' + q.total.toFixed(1) + 'ms</span>' +
    '</div>'
  const bars = '<div ' + pad + '>' +
    spanBar(0, q.total, q.total, 'req', 'request') +
    q.spans.map((s) => spanBar(s.start, s.dur, q.total, '', s.name)).join('') +
    '</div>'
  const kids = childrenOf(q.span).map((c) => requestHtml(c, childrenOf, depth + 1)).join('')
  return header + bars + kids
}

// ---- ingest ----
let traceTimer
function ingest(r) {
  records.push(r)
  if (records.length > RECORD_CAP) records.shift()
  const ch = channelOf(r)
  if (!seenChannels.has(ch)) {
    seenChannels.add(ch)
    const opt = document.createElement('option')
    opt.value = ch; opt.textContent = ch
    channelSel.append(opt)
  }
  document.getElementById('logsCount').textContent = records.length
  if (activeTab === 'logs' && matches(r)) appendRow(r)
  if (activeTab === 'traces' && r.trace) {
    clearTimeout(traceTimer); traceTimer = setTimeout(renderTraces, 250)
  }
}

// ---- tabs + filters ----
for (const btn of document.querySelectorAll('nav button')) {
  btn.onclick = () => {
    activeTab = btn.dataset.tab
    for (const b of document.querySelectorAll('nav button')) b.classList.toggle('active', b === btn)
    for (const p of document.querySelectorAll('.panel')) p.classList.toggle('active', p.dataset.tab === activeTab)
    if (activeTab === 'logs') renderLogs()
    if (activeTab === 'traces') renderTraces()
    if (activeTab === 'inflight') loadInFlight()
    if (activeTab === 'reactive') renderReactive()
    if (activeTab === 'router') renderRouter()
    if (activeTab === 'cache') loadCache()
    syncInFlightPoll()
  }
}
channelSel.onchange = () => { filters.channel = channelSel.value; renderLogs() }
document.getElementById('fTrace').oninput = (e) => { filters.trace = e.target.value.trim(); renderLogs() }
document.getElementById('fText').oninput = (e) => { filters.text = e.target.value.trim(); renderLogs() }
document.getElementById('fClear').onclick = () => {
  filters.channel = ''; filters.trace = ''; filters.text = ''
  channelSel.value = ''; document.getElementById('fTrace').value = ''; document.getElementById('fText').value = ''
  renderLogs()
}
// Click a trace id to pivot: filter logs to it and switch to the Logs tab.
feedEl.addEventListener('click', (e) => {
  const t = e.target.closest('.trace')
  if (!t || !t.dataset.trace) return
  filters.trace = t.dataset.trace
  document.getElementById('fTrace').value = t.dataset.trace
  renderLogs()
})

// ---- surface ----
const glyph = (on) => '<span class="glyph ' + (on ? 'on' : 'off') + '">' + (on ? '✓' : '·') + '</span>'
const fmtMs = (n) => n === undefined || n === null ? '·' : n + 'ms'
const fmtBytes = (n) => {
  if (n === undefined || n === null) return '·'
  if (n >= 1048576) return (n / 1048576).toFixed(1) + 'MB'
  if (n >= 1024) return (n / 1024).toFixed(1) + 'KB'
  return n + 'B'
}
const schemaBlock = (label, s) => s ? '<pre class="schema">' + esc(label + ': ' + JSON.stringify(s, null, 2)) + '</pre>' : ''

// One expandable rpc: the columnar row (surfaces line up) + a hidden detail row
// with every declared option. A JS toggle, not <details>, so WebKit's flex-summary
// double-click bug can't apply.
function rpcRow(v, i) {
  // Every option is a column now; expanding adds only the full schemas.
  const detail = v.inputSchema || v.outputSchema
    ? schemaBlock('input', v.inputSchema) + schemaBlock('output', v.outputSchema)
    : '<div class="empty">no schemas declared</div>'
  return (
    '<tr class="vrow" data-i="' + i + '">' +
    '<td><span class="method ' + esc(v.method) + '">' + esc(v.method) + '</span></td>' +
    '<td class="url">' + esc(v.url) + '</td>' +
    '<td class="c">' + glyph(!!v.inputSchema) + '</td>' +
    '<td class="c">' + glyph(v.clients.browser) + '</td>' +
    '<td class="c">' + glyph(v.clients.mcp) + '</td>' +
    '<td class="c">' + glyph(v.clients.cli) + '</td>' +
    '<td class="c">' + glyph(!!v.crossOrigin) + '</td>' +
    '<td class="c">' + glyph(v.files) + '</td>' +
    '<td class="num">' + fmtMs(v.timeout) + '</td>' +
    '<td class="num">' + fmtBytes(v.maxBodySize) + '</td>' +
    '</tr>' +
    '<tr class="vdetail" hidden><td colspan="10">' + detail + '</td></tr>'
  )
}

async function loadSurface() {
  const surfaceEl = document.getElementById('surface')
  try {
    const { rpcs, sockets, prompts } = await (await fetch(root + '/surface')).json()
    const rpcTable =
      '<table class="surface"><thead><tr>' +
      '<th>method</th><th>path</th><th class="c">schema</th><th class="c">browser</th>' +
      '<th class="c">mcp</th><th class="c">cli</th><th class="c">xorigin</th><th class="c">files</th>' +
      '<th class="num">timeout</th><th class="num">body</th>' +
      '</tr></thead><tbody>' + rpcs.map(rpcRow).join('') + '</tbody></table>'
    const socketTable = sockets.length
      ? '<table class="surface"><thead><tr><th>socket</th><th>operations</th><th>rest</th></tr></thead><tbody>' +
        sockets.map((s) =>
          '<tr><td class="url">' + esc(s.name) + '</td><td>' + esc(s.operations.map((o) => o.kind).join(' ')) + '</td>' +
          '<td><pre class="schema">' + esc(s.operations.map((o) => o.method + ' ' + o.restUrl).join('\\n')) + '</pre></td></tr>').join('') +
        '</tbody></table>'
      : '<div class="empty">none</div>'
    // Prompts (MCP-only): name, description, and the argument schema expandable
    // like a rpc's. Absent when the app declares none — keep the section out.
    const promptList = prompts || []
    const promptTable = promptList.length
      ? '<table class="surface"><thead><tr><th>prompt</th><th>description</th><th class="c">args</th></tr></thead><tbody>' +
        promptList.map((p, i) =>
          '<tr class="vrow" data-p="' + i + '"><td class="url">' + esc(p.name) + '</td>' +
          '<td>' + esc(p.description || '·') + '</td>' +
          '<td class="c">' + glyph(!!p.inputSchema) + '</td></tr>' +
          '<tr class="vdetail" hidden><td colspan="3">' +
          (p.inputSchema ? schemaBlock('arguments', p.inputSchema) : '<div class="empty">no arguments</div>') +
          '</td></tr>').join('') +
        '</tbody></table>'
      : ''
    surfaceEl.className = ''
    surfaceEl.innerHTML =
      '<h2>RPCs (' + rpcs.length + ')</h2>' + rpcTable +
      '<h2>Sockets (' + sockets.length + ')</h2>' + socketTable +
      (promptList.length ? '<h2>Prompts (' + promptList.length + ')</h2>' + promptTable : '')
    for (const row of surfaceEl.querySelectorAll('tr.vrow')) {
      row.onclick = () => {
        const detail = row.nextElementSibling
        if (detail && detail.classList.contains('vdetail')) detail.hidden = !detail.hidden
      }
    }
  } catch (e) {
    surfaceEl.innerHTML = '<div class="empty">surface failed: ' + esc(e.message) + '</div>'
  }
}

// ---- cache ----
// Snapshots the persistent (shared) store; entries change over time, so it
// refreshes on tab open and via the refresh button (not a live stream).
const fmtTtl = (n) => n === undefined ? '∞' : n === 0 ? '0' : n + 'ms'
const fmtExpiry = (n) => n === undefined || n === null ? '·' : Math.max(0, n / 1000).toFixed(1) + 's'
async function loadCache() {
  const el = document.getElementById('cache')
  try {
    const { entries } = await (await fetch(root + '/cache')).json()
    document.getElementById('cacheCount').textContent = entries.length || ''
    const refresh = '<div class="filters"><span class="pill">' + entries.length +
      ' shared ' + (entries.length === 1 ? 'entry' : 'entries') + '</span><button id="cacheRefresh">refresh</button></div>'
    if (!entries.length) {
      el.className = ''
      el.innerHTML = refresh + '<div class="empty">shared store empty — entries come from cache(fn, { shared: true, ttl: Infinity }); request-scoped reads show as per-request tallies in Logs/Traces</div>'
    } else {
      const rows = entries.map((e) =>
        '<tr><td class="url">' + esc(e.key) + '</td>' +
        '<td class="cstat ' + esc(e.status) + '">' + esc(e.status) + '</td>' +
        '<td>' + (e.remote ? 'remote' : 'producer') + '</td>' +
        '<td class="num">' + fmtTtl(e.ttl) + '</td>' +
        '<td class="num">' + fmtExpiry(e.expiresInMs) + '</td>' +
        '<td>' + esc((e.tags || []).join(' ') || '·') + (e.policy ? ' <span class="channel">' + esc(e.policy) + '</span>' : '') + '</td>' +
        '<td class="cval">' + esc(e.value || '·') + '</td></tr>').join('')
      el.className = ''
      el.innerHTML = refresh +
        '<table class="surface"><thead><tr><th>key</th><th>status</th><th>kind</th>' +
        '<th class="num">ttl</th><th class="num">expires</th><th>tags</th><th>value</th></tr></thead><tbody>' +
        rows + '</tbody></table>'
    }
    document.getElementById('cacheRefresh').onclick = loadCache
  } catch (e) {
    el.innerHTML = '<div class="empty">cache failed: ' + esc(e.message) + '</div>'
  }
}

// ---- in-flight ----
// Snapshots handlers executing right now; elapsed keeps growing, so while the
// tab is open it re-polls on an interval (the only live-changing snapshot tab).
async function loadInFlight() {
  const el = document.getElementById('inflight')
  try {
    const { requests } = await (await fetch(root + '/inflight')).json()
    document.getElementById('inflightCount').textContent = requests.length || ''
    if (!requests.length) {
      el.className = 'empty'
      el.innerHTML = 'no requests in flight — handlers appear here while they execute, then settle into Logs'
      return
    }
    const rows = requests.map((q) =>
      '<tr><td><span class="trace" data-trace="' + esc(q.trace) + '">' + esc((q.trace || '').slice(0, 8)) + '</span></td>' +
      '<td><span class="method ' + esc(q.method) + '">' + esc(q.method) + '</span></td>' +
      '<td class="url">' + esc(q.path) + (q.route ? ' <span class="channel">' + esc(q.route) + '</span>' : '') + '</td>' +
      '<td class="num">' + q.elapsedMs.toFixed(1) + 'ms</td></tr>').join('')
    el.className = ''
    el.innerHTML =
      '<div class="filters"><span class="pill">' + requests.length +
      ' in flight</span><button id="inflightRefresh">refresh</button></div>' +
      '<table class="surface"><thead><tr><th>trace</th><th>method</th><th>path</th>' +
      '<th class="num">elapsed</th></tr></thead><tbody>' + rows + '</tbody></table>'
    document.getElementById('inflightRefresh').onclick = loadInFlight
    // Pivot to the trace from an in-flight row, same as the log rows.
    for (const t of el.querySelectorAll('.trace')) t.onclick = () => {
      filters.trace = t.dataset.trace
      document.getElementById('fTrace').value = t.dataset.trace
      activeTab = 'logs'; renderLogs()
      for (const b of document.querySelectorAll('nav button')) b.classList.toggle('active', b.dataset.tab === 'logs')
      for (const p of document.querySelectorAll('.panel')) p.classList.toggle('active', p.dataset.tab === 'logs')
      syncInFlightPoll()
    }
  } catch (e) {
    el.className = 'empty'
    el.innerHTML = 'in-flight failed: ' + esc(e.message)
  }
}

// Poll only while the In-flight tab is the active one — elapsed is the only
// value that changes between snapshots, so an idle tab needs no traffic.
let inFlightTimer
function syncInFlightPoll() {
  clearInterval(inFlightTimer)
  if (activeTab === 'inflight') inFlightTimer = setInterval(loadInFlight, 1000)
}

// ---- client bridge (reactive + router) ----
// App tab(s) publish scope + router state over a same-origin BroadcastChannel
// (startClient installs the publisher when the inspector is enabled). This page
// subscribes, lists connected tabs, and renders the selected tab's scope tree +
// router state. No server round-trip — it's cross-tab, same origin.
const tabs = new Map()   // tab id -> { url, app }
const snaps = new Map()  // tab id -> { scopes, router }
let selectedTab = ''
let patchCount = 0
const rTabSel = document.getElementById('rTab')

function refreshTabOptions() {
  rTabSel.innerHTML = tabs.size
    ? [...tabs].map(([id, t]) => '<option value="' + esc(id) + '">' + esc(t.url || id) + '</option>').join('')
    : '<option value="">no app tab connected</option>'
  if (tabs.has(selectedTab)) rTabSel.value = selectedTab
}

function selectTab(id) {
  selectedTab = id
  refreshTabOptions()
  if (chan) chan.postMessage({ kind: 'request', tab: id })
  renderReactive(); renderRouter()
}

rTabSel.onchange = () => { if (rTabSel.value) selectTab(rTabSel.value) }
document.getElementById('rRefresh').onclick = () => {
  if (selectedTab && chan) chan.postMessage({ kind: 'request', tab: selectedTab })
}

// Flat [{id,parent,state,recorded}] list → nested tree by parent id (the app side
// can't ship the children array, so the inspector rebuilds the forest here).
function renderReactive() {
  const el = document.getElementById('reactive')
  const snap = snaps.get(selectedTab)
  const scopes = (snap && snap.scopes) || []
  document.getElementById('reactiveCount').textContent = scopes.length || ''
  document.getElementById('rPatch').textContent = patchCount ? patchCount + ' patches' : ''
  if (!selectedTab || !scopes.length) {
    el.className = 'empty'
    el.innerHTML = tabs.size
      ? 'no scopes in this tab yet — interact with the app to create reactive state'
      : 'open a page of this app in another tab (same browser) — its scope tree appears here'
    return
  }
  const kids = new Map()
  for (const s of scopes) {
    const p = s.parent || ''
    if (!kids.has(p)) kids.set(p, [])
    kids.get(p).push(s)
  }
  const render = (s, depth) => {
    // Indent by depth on top of the base 16px the .shead/.json CSS already sets.
    const pad = 'style="padding-left:' + (16 + depth * 16) + 'px"'
    const rec = s.recorded ? '<span class="srec">recorded</span>' : ''
    const label = s.label ? '<span class="slbl">&lt;' + esc(s.label) + '&gt;</span>' : ''
    const head =
      '<div class="shead" ' + pad + '><span class="sid">' + esc(s.id) + '</span>' + label + rec + '</div>'
    const body = '<pre class="json" ' + pad + '>' + esc(JSON.stringify(s.state, null, 2)) + '</pre>'
    const childHtml = (kids.get(s.id) || []).map((c) => render(c, depth + 1)).join('')
    return '<div class="scope">' + head + body + childHtml + '</div>'
  }
  el.className = ''
  el.innerHTML = (kids.get('') || []).map((s) => render(s, 0)).join('')
}

function renderRouter() {
  const el = document.getElementById('router')
  const snap = snaps.get(selectedTab)
  const r = snap && snap.router
  if (!r) {
    el.className = 'empty'
    el.innerHTML = 'open a page of this app in another tab (same browser) — its router state appears here'
    return
  }
  const row = (k, v) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>'
  el.className = ''
  el.innerHTML = '<dl class="router">' +
    row('path', r.path) + row('route', r.route || '·') +
    row('params', JSON.stringify(r.params || {})) + row('url', r.url) +
    row('navigating', r.navigating) + row('history entry', r.entry) + '</dl>'
}

const chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('abide:inspector') : undefined
if (chan) {
  chan.onmessage = (event) => {
    const m = event.data || {}
    if (!m.tab) return
    if (m.kind === 'announce') {
      tabs.set(m.tab, { url: m.url, app: m.app })
      refreshTabOptions()
      if (!selectedTab) selectTab(m.tab)
    } else if (m.kind === 'snapshot') {
      snaps.set(m.tab, { scopes: m.scopes, router: m.router })
      if (m.tab === selectedTab && activeTab === 'reactive') renderReactive()
      if (m.tab === selectedTab && activeTab === 'router') renderRouter()
    } else if (m.kind === 'nav') {
      const prev = snaps.get(m.tab) || {}
      snaps.set(m.tab, { scopes: prev.scopes || [], router: m.router })
      if (m.tab === selectedTab && activeTab === 'router') renderRouter()
    } else if (m.kind === 'patch') {
      if (m.tab === selectedTab) {
        patchCount++
        if (activeTab === 'reactive') document.getElementById('rPatch').textContent = patchCount + ' patches'
      }
    } else if (m.kind === 'bye') {
      tabs.delete(m.tab); snaps.delete(m.tab)
      // The selected tab left: fall through to another still-connected tab if one
      // remains, else clear the selection and render the empty state.
      if (m.tab === selectedTab) {
        const next = tabs.keys().next().value
        if (next) { selectTab(next) } else { selectedTab = ''; renderReactive(); renderRouter() }
      }
      refreshTabOptions()
    }
  }
  // Announce arrival so already-open app tabs (re)publish their presence + state.
  chan.postMessage({ kind: 'hello' })
}

// ---- live feed ----
// Track the buffer epoch (the id prefix). A new epoch means a fresh worker
// replaying its whole tail (after a reconnect/swap), so clear the feed to avoid
// appending those records as duplicates on top of what's already shown.
let currentEpoch
const source = new EventSource(root + '/events')
source.onmessage = (event) => {
  const epoch = (event.lastEventId || '').split(':')[0]
  if (epoch !== currentEpoch) { feedEl.innerHTML = ''; currentEpoch = epoch }
  ingest(JSON.parse(event.data))
}

loadSurface()
</script>
</body>
</html>`
}

// Minimal HTML-attribute/text escaping for the values interpolated server-side.
function escapeHtml(value: string): string {
    return value.replace(/[&<>"]/g, (character) => {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character] ?? character
    })
}
