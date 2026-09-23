// THE DOCS APP'S OWN CLIENT CODE — the scroll spy in the rail, and everything an example card
// does: the tabs, the reload, the frame's height, and the measure panel. Imperative DOM work
// over nodes the page painted: a `srcdoc` frame, a message channel, a panel written through
// `innerHTML`.
//
// THE PAGE HANDS ITS OWN NODES OVER (32.9). `<main id="content" bind:element={installDocs}>` is
// the whole wiring: the callback is handed the element when it arrives and its `Disposer` is
// what a navigation runs — so the window listeners of the page a reader left go with that page
// rather than being watched for. It was a `MutationObserver` over the body until the compiler
// emitted the binding, which is the same thing guessed at.

import { escapeText } from 'abide'

// THE BRIDGE THE INSTRUMENTED FRAME GETS, appended after the harness and before the
// arm. It belongs to the DOCUMENTATION rather than to the harness — 40.18 — so it
// lives here beside the rest of the page's own script rather than in the injectable.
// WHAT THE FRAME SENDS BACK, as loosely as the panel reads it. The shape is the measure lane's
// (`harness/report`) and this file is the DOCUMENTATION's side of the bridge — typing it against
// the lane would put an import from the harness in the app's own client bundle for a record that
// arrives over `postMessage` as JSON.
type Reading = Record<string, any>

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

// Scroll-spy. Offsets are MEASURED ONCE — on load, on resize, and after the webfonts
// swap, which is itself a reflow — so the scroll handler is arithmetic with no layout
// read in it. An IntersectionObserver band was tried first and got two cases wrong:
// nothing was active at the top, and the last sections never activated because at max
// scroll they never enter the band.
function installScrollSpy(signal: AbortSignal) {
    const headings = [...document.querySelectorAll('main h2[id], main h3[id]')]
    const links = headings.map((h) =>
        document.querySelector(`.toc a[href="#${h.id}"]`),
    )
    let offsets: number[] = []
    // Read here rather than in `update`: it is a layout read, and `update` runs per scroll
    // frame after the previous frame wrote `aria-current` — which would force the layout that
    // write invalidated, every frame of every scroll. Content height is stable between
    // `measure` calls for the same reason `offsets` are.
    let bottom = 0
    let current = -1

    function measure() {
        // HOISTED, and it buys reads rather than forced layouts — the forced-layout COUNT does not
        // move for this (median 9 either way). A RUN OF READS WITH NO WRITE BETWEEN THEM FORCES
        // THE LAYOUT ONCE, so ten `scrollY` reads here were nine redundant reads and never nine
        // reflows. Kept because it is less work and simpler, not because it was faster.
        const scrolled = window.scrollY
        // Pre-sized and walked rather than mapped: this walks per heading, and a `map` allocates
        // the intermediate as well as the result.
        const measured = new Array<number>(headings.length)
        for (let index = 0; index < headings.length; index += 1)
            measured[index] =
                (headings[index] as Element).getBoundingClientRect().top +
                scrolled
        offsets = measured
        // EVERY READ BEFORE THE WRITE `update` MAKES. This is the ordering that matters.
        bottom = document.documentElement.scrollHeight
        update()
    }

    function update() {
        const line = window.scrollY + 80
        let next = 0
        for (let i = 0; i < offsets.length; i += 1)
            if ((offsets[i] as number) <= line) next = i
        // At the bottom there is no room left to scroll the last heading up to the line.
        if (window.innerHeight + window.scrollY >= bottom - 2) {
            next = offsets.length - 1
        }
        if (next === current) return
        links[current]?.removeAttribute('aria-current')
        links[next]?.setAttribute('aria-current', 'true')
        current = next
    }

    let queued = false
    addEventListener(
        'scroll',
        () => {
            if (queued) return
            queued = true
            requestAnimationFrame(() => {
                queued = false
                update()
            })
        },
        { passive: true, signal },
    )
    addEventListener('resize', measure, { passive: true, signal })
    // OWED ONLY WHERE THE SWAP IS STILL TO COME. The webfont swap is a reflow and moves every
    // offset, so a measure after it is real — but on a CLIENT NAVIGATION `fonts.ready` is already
    // resolved, and this ran a second whole measure one microtask behind the first for nothing.
    if (document.fonts !== undefined && document.fonts.status !== 'loaded')
        document.fonts.ready.then(measure)
    // DEFERRED PAST THE ROUTER'S MUTATIONS BY ONE FRAME, and the reason is the opposite of what a
    // counter said. `installScrollSpy` runs from a `bind:element` callback DURING mount, so
    // measuring inline forces a layout of the whole page the router has just inserted. The forced
    // COUNT is identical either way — which is why this was tried, dropped, and then measured
    // properly: `bun run bench:share` puts `abide.mount` at 22.6% of click-to-paint with the
    // measure inline and 14.7-16.2% with it deferred, over two runs. Same number of forced
    // layouts, ~7 points of the op between them, because what costs is WHEN the layout is forced
    // and not how often.
    //
    // WHAT IT COSTS: one frame in which `offsets` is empty, immediately after a navigation that
    // has just scrolled to the top — so the spy has nothing to report yet anyway.
    requestAnimationFrame(() => {
        if (!signal.aborted) measure()
    })
}

// THE READING, RENDERED, in the same four columns as the Bench table beside it —
// metric, abide, hand-written, ratio. The abide column is EMPTY rather than absent:
// a missing column reads as a table that does not compare, and an empty one reads
// as the comparison that has not happened yet, which is the true statement.
const COUNTS: [string, string][] = [
    ['Elements moved', 'elementsMoved'],
    ['Markers moved', 'markersMoved'],
    ['Text nodes moved', 'textMoved'],
    ['Nodes created', 'nodesCreated'],
    ['Attributes set', 'attributesSet'],
    ['Class writes', 'classWrites'],
    ['Style writes', 'styleWrites'],
    ['Data writes', 'dataWrites'],
    ['Redundant data writes', 'redundantDataWrites'],
    ['Listeners bound', 'listenersBound'],
    ['Binding runs', 'bindingRuns'],
    ['Wakes', 'wakes'],
    ['Descents', 'descents'],
]
const ENGINES = {
    v8: 'V8',
    jsc: 'JavaScriptCore',
    spidermonkey: 'SpiderMonkey',
    unknown: 'an engine we could not name',
}
const ARMS = ['abide', 'hand-written']
const NOTHING = '\u2014'

function millis(nanoseconds: number) {
    if (nanoseconds >= 1e6) return `${(nanoseconds / 1e6).toFixed(2)} ms`
    if (nanoseconds >= 1e3) return `${(nanoseconds / 1e3).toFixed(2)} \u00b5s`
    return `${Math.round(nanoseconds)} ns`
}
function refusalHtml(why: string) {
    return (
        '<p class="ex-measure-refused">' +
        escapeText(why) +
        '</p>' +
        '<button type="button" class="ex-measure-run" data-measure-run>Try again</button>'
    )
}
function cell(value: unknown) {
    return (
        '<td>' +
        (value === null || value === undefined
            ? `<span class="ex-tag">${NOTHING}</span>`
            : `<code>${escapeText(value)}</code>`) +
        '</td>'
    )
}
// A TAG IS NOT A NUMBER. ratio() hands back a discriminated result and the tags are
// the whole reason: two values inside the measured floor do not divide, and a
// frame-quantised pair divides to 1.01x, which is the claim the harness exists to
// refuse.
function ratioCell(answer: Reading | null) {
    if (!answer)
        return (
            '<td class="ex-ratio"><span class="ex-tag">' +
            NOTHING +
            '</span></td>'
        )
    if (answer.kind === 'underTheFloor')
        return '<td class="ex-ratio"><span class="ex-tag">under the floor</span></td>'
    if (answer.kind === 'underOneFrame')
        return '<td class="ex-ratio"><span class="ex-tag">under one frame</span></td>'
    const klass =
        answer.value === 1
            ? ''
            : answer.value < 1
              ? ' class="ex-good"'
              : ' class="ex-bad"'
    return (
        '<td class="ex-ratio"><code' +
        klass +
        '>' +
        answer.value.toFixed(2) +
        'x</code></td>'
    )
}
// ONLY ONE ARM CAN HAVE RENDERED THE PAGE — two arms cannot both own a document — so every load
// row is the loaded arm's cell and a blank beside it. Read through `ARMS` rather than by naming
// the two: an arm name spelled per row is the one a third arm gets missed in.
function loadedOnly(reading: Reading, value: unknown) {
    return ARMS.map((arm) =>
        cell(arm === reading.loadedArm ? value : null),
    ).join('')
}
function tableHtml(caption: string, rows: string) {
    if (!rows) return ''
    return (
        '<table class="ex-bench"><thead><tr><th>' +
        caption +
        '</th><th>abide</th>' +
        '<th>Hand-written</th><th class="ex-ratio">Ratio</th></tr></thead><tbody>' +
        rows +
        '</tbody></table>'
    )
}
// One row of either table: the metric, its cells, and the ratio column.
function row(label: string, cells: string, ratio: Reading | null) {
    return '<tr><td>' + label + '</td>' + cells + ratioCell(ratio) + '</tr>'
}
function loadRows(reading: Reading) {
    let rows = ''
    for (const [label, key] of COUNTS) {
        const value = reading.load[key]
        // A NULL IS NOT A ZERO. Wakes, binding runs and descents are read off a record
        // abide publishes, and nothing publishes one yet — so the cell says the lane
        // did not count it rather than that it counted none.
        if (value === null || !value) continue
        rows += row(label, loadedOnly(reading, value), null)
    }
    const paint = reading.paint || {}
    const first =
        paint.firstContentfulPaint != null
            ? paint.firstContentfulPaint
            : paint.firstPaint
    if (first != null)
        rows += row(
            'First paint',
            loadedOnly(reading, `${first.toFixed(1)} ms`),
            null,
        )
    rows += row(
        'Nodes in the document',
        loadedOnly(reading, reading.size.nodes),
        null,
    )
    return rows
}
function opRows(reading: Reading) {
    if (!reading.timing) return ''
    let rows = ''
    for (const [label, key] of COUNTS) {
        const values = ARMS.map((arm) =>
            reading.arms[arm] ? reading.arms[arm].work[key] : null,
        )
        if (values.every((value) => value === null || !value)) continue
        rows += row(
            label,
            values.map(cell).join(''),
            values[0] !== null && values[1]
                ? { kind: 'ratio', value: values[0] / values[1] }
                : null,
        )
    }
    rows += row(
        'Time per op',
        ARMS.map((arm) =>
            cell(
                reading.arms[arm]
                    ? millis(reading.arms[arm].nanosecondsPerOp)
                    : null,
            ),
        ).join(''),
        reading.ratios.abide,
    )
    rows += row(
        'p95',
        ARMS.map((arm) =>
            cell(reading.arms[arm] ? millis(reading.arms[arm].p95) : null),
        ).join(''),
        null,
    )
    return rows
}
function readingHtml(reading: Reading | null, windowMs: number) {
    if (!reading) return refusalHtml('The frame reported nothing.')
    const engine =
        (ENGINES as Record<string, string>)[reading.substrate] ??
        reading.substrate
    let html = tableHtml('On load', loadRows(reading))
    html += tableHtml(escapeText(reading.op), opRows(reading))
    // WHY THE ABIDE COLUMN IS EMPTY, said once and plainly. An empty column with no
    // explanation reads as a measurement that came back zero.
    const missing = ARMS.filter(
        (arm) => arm !== reading.loadedArm && !reading.arms[arm],
    )
    if (missing.length) {
        html +=
            '<p class="ex-note">The <strong>' +
            missing.join(' and ') +
            '</strong> column is empty because that arm does not run yet ' +
            '\u2014 the compiler has to emit a page before there is anything to load beside the hand-written one. ' +
            'Both arms have to be batched in ONE run, or the two get different sample sizes and the ratio is refused.</p>'
    }
    const facts = [`counted over the first <strong>${windowMs} ms</strong>`]
    if (reading.paint?.longTasks)
        facts.push(`<strong>${reading.paint.longTasks}</strong> long tasks`)
    if (reading.timing) {
        facts.push(
            '<span class="ex-reading-detail">n=' +
                reading.timing.n +
                ' \u00b7 ' +
                reading.timing.reps +
                ' reps \u00b7 floor \u00b1' +
                (reading.timing.floor * 100).toFixed(2) +
                '%</span>',
        )
    }
    html += `<p class="ex-note">${facts.join(' \u00b7 ')}</p>`
    html +=
        '<p class="ex-note">Measured in <strong>your</strong> browser just now, on ' +
        engine +
        ', whose clock steps every ' +
        millis(reading.clockNanoseconds) +
        '.' +
        (reading.timing
            ? ''
            : ' No repeatable op is named here, so there is no duration to batch.') +
        ' These are not our numbers and they are not a claim \u2014 the counts are the same everywhere, the timings are yours.</p>'
    html +=
        '<button type="button" class="ex-measure-run" data-measure-run>Measure again</button>'
    return html
}

// The measure lane, fetched once per PAGE and only if a reader opens a panel — it is the
// same bytes whichever card asks for it.
let harness: string | null = null

// Panel tabs and file tabs are the same interaction, so one delegated listener per example serves
// both rather than a listener per button. RELOAD rides along, and it re-runs the arm from nothing
// rather than replaying anything: the frame's transient states are the arm's own, so a first load
// is something to do again rather than a strip to play.
function installExamples(main: Element, signal: AbortSignal) {
    for (const example of main.querySelectorAll('.example')) {
        const browser = example.querySelector('.ex-browser')
        // ONE CAST, at the one place the node is found: `querySelector` answers `Element` and
        // every use below wants the frame — its `contentWindow`, its `srcdoc`, its height.
        const frame = (browser?.querySelector('.ex-result') ??
            null) as HTMLIFrameElement | null
        const source = frame?.getAttribute('srcdoc') ?? null

        addEventListener(
            'message',
            (event) => {
                if (!frame || event.source !== frame.contentWindow) return
                // A measured height, which is the one thing a stylesheet cannot know.
                if (event.data?.abideHeight) {
                    frame.style.height = `${event.data.abideHeight}px`
                    return
                }
                // The gesture the frame declined, put back where the reader aimed it.
                if (event.data?.abideWheel) {
                    scrollBy(event.data.abideWheel.x, event.data.abideWheel.y)
                    return
                }
                // The instrumented frame is ready to be asked.
                if (event.data?.abideMeasureReady) {
                    askToMeasure()
                    return
                }
                if (
                    event.data &&
                    (event.data.abideReading || event.data.abideRefused)
                ) {
                    paintReading(
                        event.data.abideReading,
                        event.data.abideRefused,
                        event.data.abideWindow,
                    )
                    return
                }
            },
            { signal },
        )

        // THE MEASURE PANEL. A reading cannot be taken retroactively — counting a load
        // means arming before the arm's first line — so this reloads the frame with the
        // instrument prepended. The harness is fetched once per page and only if asked,
        // so a reader who never opens the panel pays nothing at all.
        // Still the data-measure hook: the live half kept it when it moved into the Bench
        // panel, so nothing here has to know which tab it is under.
        const measurePanel = example.querySelector(
            '[data-measure]',
        ) as HTMLElement | null
        let measuring = false

        function askToMeasure() {
            if (!measuring) return
            const ask: Record<string, unknown> = {
                op: 'load',
                scriptBytes: (source ?? '').length,
            }
            if (measurePanel?.dataset.selector !== undefined) {
                ask.op = measurePanel.dataset.op
                ask.selector = measurePanel.dataset.selector
                ask.event = measurePanel.dataset.event
            }
            frame?.contentWindow?.postMessage({ abideMeasure: ask }, '*')
        }

        function paintReading(
            reading: Reading | null,
            refused: string | null,
            windowMs: number,
        ) {
            measuring = false
            if (!measurePanel) return
            measurePanel.innerHTML = refused
                ? refusalHtml(refused)
                : readingHtml(reading, windowMs)
        }

        async function measureHere() {
            if (measuring || !frame || source === null || !measurePanel) return
            measuring = true
            measurePanel.innerHTML =
                '<p class="ex-note">Running the arm again with the counters armed…</p>'
            if (harness === null) {
                try {
                    // ONE ADDRESS, ABSOLUTE. While the docs were a tree of files this was resolved
                    // against the page's own stylesheet link — a page two directories down asked
                    // for its own `measure.js`, got the 404 body back and put "404" in a script
                    // tag. An app serves it at one address from every page, so there is nothing
                    // to resolve and nothing to get wrong.
                    const answer = await fetch('/measure.js')
                    // A 404 BODY IS NOT AN INSTRUMENT. Unchecked, it became the script.
                    if (!answer.ok)
                        throw new Error(`measure.js answered ${answer.status}`)
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
                    measurePanel.innerHTML = refusalHtml(
                        `The instrument did not load: ${error}`,
                    )
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
            // A LITERAL `</script>` IS SAFE HERE and was not where this lived before: an inline
            // script ends at the first one a parser sees, which cost four separate escaping bugs
            // while this was a template literal inside a template literal. In a module it is a
            // string like any other.
            ;(frame as HTMLIFrameElement).srcdoc =
                '<script>' +
                harness +
                '</script><script>' +
                MEASURE_BRIDGE +
                '</script>' +
                source
        }

        // Registered above, so now ask: the frame has already run and already counted.
        function ask() {
            frame?.contentWindow?.postMessage({ abideAsk: 1 }, '*')
        }
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
            const watching = new IntersectionObserver((entries, watcher) => {
                if (started || !entries.some((entry) => entry.isIntersecting))
                    return
                started = true
                watcher.disconnect()
                frame.srcdoc = source
            })
            watching.observe(frame)
            signal.addEventListener('abort', () => {
                watching.disconnect()
            })
        }

        example.addEventListener('click', (event) => {
            // A DELEGATED LISTENER READS WHERE THE CLICK LANDED, which is an `EventTarget` to
            // the type and always an element to a document that has no shadow roots in it.
            const target = event.target as Element
            if (target.closest('[data-reload]')) {
                if (frame && source !== null) frame.srcdoc = source
                return
            }
            if (target.closest('[data-measure-run]')) {
                measureHere()
                return
            }
            const button = target.closest(
                'button[role=tab]',
            ) as HTMLElement | null
            if (!button) return
            const panel = button.dataset.panel
            if (panel) {
                for (const tab of example.querySelectorAll(
                    '.ex-tablist button',
                )) {
                    tab.setAttribute('aria-selected', String(tab === button))
                }
                for (const body of example.querySelectorAll<HTMLElement>(
                    '.ex-panel',
                ))
                    body.hidden = body.dataset.panel !== panel
                return
            }
            const file = button.dataset.file
            if (!file) return
            const group = file.slice(0, file.indexOf(':') + 1)
            for (const tab of example.querySelectorAll<HTMLElement>(
                '.ex-files button',
            )) {
                if (tab.dataset.file?.startsWith(group) === true)
                    tab.setAttribute('aria-selected', String(tab === button))
            }
            for (const body of example.querySelectorAll<HTMLElement>(
                '.ex-panel > [data-file]',
            )) {
                if (body.dataset.file?.startsWith(group) === true)
                    body.hidden = body.dataset.file !== file
            }
        })
    }
}

// 32.9's callback: the node, and the teardown for it. One `AbortController` per install, so the
// window listeners a page's own cards and rail hang on the window leave with that page — which
// is what a `Disposer` is for and what a navigation runs.
export function installDocs(main: Element): () => void {
    const installing = new AbortController()
    installScrollSpy(installing.signal)
    installExamples(main, installing.signal)
    return () => {
        installing.abort()
    }
}
