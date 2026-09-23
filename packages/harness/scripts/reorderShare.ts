// THE REORDER SHARE — the op `bench:share` explicitly does not bound, and the one both compiler
// proposals pre-registered on.
//
// `explorations/NAME-THE-SHARE.md` measured a page navigation and a first load and said in terms
// that its ~8% does not bound a REORDER: a list reorder is more script-heavy than a navigation, so
// neither `no-build` (which registered on a 500-row reorder, "<8% and it's decided, >20% and I'm
// wrong") nor `compiler-maximalist` had been answered. This is that measurement.
//
// IT IS ONLY POSSIBLE NOW. `shares()` reads its numerator from the `performance.measure` pairs the
// code under test emits, and abide emitted none until `ui/measureLayer.ts`.
//
// THREE CASES, AND THE THIRD IS THE ONE THAT ANSWERS THE QUESTION. The 500-row REVERSE is the op
// the proposals named and the TWO-ROW SWAP is the distinguishing edit — but a KEYED reorder
// instantiates NO template at all: every row survives, `makeRow` is never called, and the layer
// `no-build` registered its threshold against does not run in the op it registered it on. That is
// a mis-specification in the proposal, not in the reconcile. So the third case REPLACES every key.
//
// AND THE THIRD CASE CARRIES A HAND-WRITTEN ARM, because a share is not a verdict. 53% of an op
// says the layer is worth looking at; it does not say the layer is SLOW. Without another
// implementation doing the same work on the same input, the target may already be the floor —
// CLAUDE.md's existence proof, and the reason this file reports a RATIO and the work counters
// beside it rather than a fraction alone.

import { chromium, type Page } from '@playwright/test'

import { shares } from '../src/engine/shares.ts'
import { traceOp } from '../src/engine/traceOp.ts'
import { THRESHOLDS } from '../src/report/THRESHOLDS.ts'
import { buildCompiledPage } from './buildCompiledPage.ts'

// Spelled here rather than imported — see the same note in `nameTheShare.ts`.
const LAYER_RECONCILE = 'abide.reconcile'
const LAYER_VANILLA = 'vanilla.build'

// `bun run bench:reorder 2000` — the n is a lever because the PERCEPTION rule needs it. A share is
// not a reason to change anything on its own: an optimisation is worth designing against where the
// cost crosses a frame or an interaction budget, and that is a question about n rather than about
// the layer. Sweeping it is how the crossing point gets stated instead of assumed.
const ROWS = Number(process.argv[2] ?? '500')
const RUNS = 5

// A ROW WITH A BINDING IN IT, because a row of static markup prices a reorder no real list does:
// what a keyed reconcile has to carry is the row's own scope, and a row with nothing reactive in
// it has none.
const PAGE_SOURCE = `<script>
import { reactive } from 'abide'

const rows = reactive(
    Array.from({ length: ${ROWS} }, (_, at) => ({ id: at, label: 'row ' + at })),
)

function reverse() {
    rows.set([...rows()].reverse())
}

function swap() {
    const next = [...rows()]
    const held = next[1]
    next[1] = next[${ROWS - 2}]
    next[${ROWS - 2}] = held
    rows.set(next)
}

function replace() {
    rows.set(
        Array.from({ length: ${ROWS} }, (_, at) => ({
            id: ${ROWS} + at,
            label: 'new ' + at,
        })),
    )
}

function append() {
    rows.set([
        ...rows(),
        ...Array.from({ length: ${ROWS} }, (_, at) => ({
            id: ${ROWS} + at,
            label: 'new ' + at,
        })),
    ])
}

function clear() {
    rows.set([])
}
</script>

<ul id="list">
{#for row of rows by row.id}
    <li><span>{row.label}</span></li>
{/for}
</ul>
<button id="reverse" onclick={reverse}>reverse</button>
<button id="swap" onclick={swap}>swap</button>
<button id="replace" onclick={replace}>replace</button>
<button id="append" onclick={append}>append</button>
<button id="clear" onclick={clear}>clear</button>`

// THE SAME LIST WITH NO BINDING IN THE ROW — the decomposition arm. Identical row count, identical
// keyed `{#for}`, identical replace; the only difference is that the row's body is STATIC, so no
// per-row read is bound and no per-row binding has to be built or stopped. What the gap between
// this and the arm above measures is exactly the per-row reactive construction, isolated by
// varying the INPUT rather than by instrumenting the framework — which a per-row timer could not
// do anyway, since `performance.now()` is coarsened far above one row's cost.
const STATIC_SOURCE = PAGE_SOURCE.replace(
    '<li><span>{row.label}</span></li>',
    '<li><span>row</span></li>',
)

// THE PAGE SOMEBODY WRITES WHEN NOTHING IS COMPILING FOR THEM, and not an expert's version of it:
// it rebuilds the list with `createElement` and one `replaceChildren`, which is what a person
// reaches for. It marks the same shape of pair abide does, so the two layers are read by one
// instrument rather than compared across two.
const VANILLA_MARKUP =
    `<ul id="list">${Array.from({ length: ROWS }, (_, at) => `<li><span>row ${at}</span></li>`).join('')}</ul>` +
    `<button id="replace">replace</button>`

const VANILLA_BODIES: Record<string, string> = {
    // What a person reaches for.
    createElement: `
    const next = []
    for (let at = 0; at < ${ROWS}; at += 1) {
        const row = document.createElement('li')
        const label = document.createElement('span')
        label.textContent = 'new ' + at
        row.appendChild(label)
        next.push(row)
    }
    list.replaceChildren(...next)`,
    // EXACTLY WHAT THE EMITTER DOES, with no abide around it: one `innerHTML` parse a row. This
    // arm is here to attribute the cost rather than to be written by anybody — if it lands near
    // abide's own number then parsing IS the story and nothing else in `makeRow` needs explaining.
    innerHTML: `
    const scratch = document.createElement('template')
    const next = []
    for (let at = 0; at < ${ROWS}; at += 1) {
        scratch.innerHTML = '<li><span>' + ('new ' + at) + '</span></li>'
        next.push(scratch.content.firstChild)
    }
    list.replaceChildren(...next)`,
    // THE LADDER. The arms below build the hand-written page UP toward what `makeRow` does, one
    // component at a time, so the ~11 µs a row that parsing does not explain gets attributed
    // instead of guessed at. Each step adds exactly one thing abide does and nothing else.
    //
    // STEP 1 — parse per row, but INSERT EACH NODE INTO THE LIVE LIST rather than batching with
    // one `replaceChildren`. `makeRow` does `parent.insertBefore(node, before)` against the
    // document, which is not the same DOM work as handing a finished array over once.
    ladderInsert: `
    const scratch = document.createElement('template')
    list.replaceChildren()
    for (let at = 0; at < ${ROWS}; at += 1) {
        scratch.innerHTML = '<li><span>' + ('new ' + at) + '</span></li>'
        const nodes = []
        for (let n = scratch.content.firstChild; n !== null; n = n.nextSibling) nodes.push(n)
        for (const node of nodes) list.insertBefore(node, null)
    }`,
    // STEP 2 — and a SCOPE a row, which is what `list.mount` allocates whether or not the row has
    // a binding in it. The static-row arm above showed the binding is 4-7%; this asks what the
    // scope alone costs.
    ladderScope: `
    class Scope { constructor() { this.stops = []; this.owned = null } }
    const scratch = document.createElement('template')
    list.replaceChildren()
    for (let at = 0; at < ${ROWS}; at += 1) {
        scratch.innerHTML = '<li><span>' + ('new ' + at) + '</span></li>'
        const nodes = []
        for (let n = scratch.content.firstChild; n !== null; n = n.nextSibling) nodes.push(n)
        for (const node of nodes) list.insertBefore(node, null)
        const scope = new Scope()
        if (scope.stops.length !== 0) throw new Error('unreachable')
    }`,
    // STEP 3 — and the ROW RECORD `rowOf` mints, plus the keyed bookkeeping the reconcile keeps:
    // a Map entry a row, and the two per-row arrays the resolve pass fills.
    ladderKeyed: `
    class Scope { constructor() { this.stops = []; this.owned = null } }
    const scratch = document.createElement('template')
    list.replaceChildren()
    const held = new Map()
    const from = new Array(${ROWS})
    const survivor = new Array(${ROWS})
    for (let at = 0; at < ${ROWS}; at += 1) {
        scratch.innerHTML = '<li><span>' + ('new ' + at) + '</span></li>'
        const nodes = []
        for (let n = scratch.content.firstChild; n !== null; n = n.nextSibling) nodes.push(n)
        for (const node of nodes) list.insertBefore(node, null)
        const row = { key: ${ROWS} + at, data: null, nodes, scope: new Scope(), at }
        held.set(row.key, row)
        from[at] = -1
        survivor[at] = null
    }`,
    // STEP 4 — `ls0_make` AND `rowOf` REPRODUCED FAITHFULLY, in plain JS: the `TEMPLATES` WeakMap
    // lookup a row, the `firstChild`/`nextSibling` walk `markupNodes` does, `escapeText`'s brand
    // check and regex scan, and the five-part concat the emitter writes. This is the rung that
    // splits "the cost is in `make`" from "the cost is in everything around it" — the rungs above
    // simplify `make`, and if this one lands near them then `make` is not where the gap is.
    ladderFaithful: `
    class Scope { constructor() { this.stops = []; this.owned = null } }
    class Raw { constructor(html) { this.html = html } }
    const TEMPLATES = new WeakMap()
    function parseMarkup(near, markup) {
        const doc = near.ownerDocument ?? near
        let t = TEMPLATES.get(doc)
        if (t === undefined) { t = doc.createElement('template'); TEMPLATES.set(doc, t) }
        t.innerHTML = markup
        return t.content
    }
    function markupNodes(near, markup) {
        const nodes = []
        for (let n = parseMarkup(near, markup).firstChild; n !== null; n = n.nextSibling) nodes.push(n)
        return nodes
    }
    const SPECIAL = /[&<>]/
    function escapeText(value) {
        if (value instanceof Raw) return value.html
        const text = value == null ? '' : String(value)
        return text.search(SPECIAL) === -1 ? text : text
    }
    list.replaceChildren()
    const held = new Map()
    const from = new Array(${ROWS})
    const survivor = new Array(${ROWS})
    for (let at = 0; at < ${ROWS}; at += 1) {
        const nodes = markupNodes(list, "<li>" + "<span>" + escapeText('new ' + at) + "</span>" + "</li>")
        for (const node of nodes) list.insertBefore(node, null)
        const row = { key: ${ROWS} + at, data: null, nodes, scope: new Scope(), at }
        held.set(row.key, row)
        from[at] = -1
        survivor[at] = null
    }`,
    // ONE PARSE FOR THE WHOLE TREE, which is what `fillRegion` does and what a row build does NOT.
    // The row result — construction beats parsing 7x — is a result about a TINY string, where the
    // parser's fixed setup dominates. A region fill hands the parser a whole page at once, the
    // fixed cost amortises over thousands of bytes, and the per-byte work is C++ against JS doing
    // one call per node. This arm is whether the same change helps there or hurts.
    oneParse: `
    let markup = ''
    for (let at = 0; at < ${ROWS}; at += 1) {
        markup += '<li><span>' + ('new ' + at) + '</span></li>'
    }
    list.innerHTML = markup`,
    // A CURSOR/PAINTER, WHICH IS WHAT AXIS 4'S FALLBACK WOULD EMIT: the row is built by CALLING
    // an interface per node and per position rather than by generating markup. This is the arm
    // that prices the objection — "every painter call is a property load on a polymorphic site"
    // — and it is the only thing left unmeasured before that redesign could be argued.
    painter: `
    function Painter() { this.current = null; this.stack = [] }
    Painter.prototype.open = function (tag) {
        const el = document.createElement(tag)
        if (this.current !== null) this.current.appendChild(el)
        this.stack.push(this.current)
        this.current = el
    }
    Painter.prototype.text = function (value) {
        this.current.appendChild(document.createTextNode(value))
    }
    Painter.prototype.close = function () {
        const done = this.current
        this.current = this.stack.pop()
        return done
    }
    const only = new Painter()
    const next = []
    for (let at = 0; at < ${ROWS}; at += 1) {
        only.open('li')
        only.open('span')
        only.text('new ' + at)
        only.close()
        next.push(only.close())
    }
    list.replaceChildren(...next)`,
    // THE SAME, WITH THE CALL SITES GENUINELY POLYMORPHIC. One painter in a page is a monomorphic
    // site and proves nothing about the objection: the fallback has TWO — a DomPainter building a
    // row and an AdoptPainter walking the server's — so the sites see two shapes. Alternating per
    // row is what puts two hidden classes through one site.
    painterTwo: `
    function PainterA() { this.current = null; this.stack = [] }
    function PainterB() { this.stack = []; this.current = null; this.spare = 0 }
    for (const Shape of [PainterA, PainterB]) {
        Shape.prototype.open = function (tag) {
            const el = document.createElement(tag)
            if (this.current !== null) this.current.appendChild(el)
            this.stack.push(this.current)
            this.current = el
        }
        Shape.prototype.text = function (value) {
            this.current.appendChild(document.createTextNode(value))
        }
        Shape.prototype.close = function () {
            const done = this.current
            this.current = this.stack.pop()
            return done
        }
    }
    const first = new PainterA()
    const second = new PainterB()
    const next = []
    for (let at = 0; at < ${ROWS}; at += 1) {
        const p = at % 2 === 0 ? first : second
        p.open('li')
        p.open('span')
        p.text('new ' + at)
        p.close()
        next.push(p.close())
    }
    list.replaceChildren(...next)`,
    // THE SHAPE PARSED ONCE AND CLONED, which is what the compiler could emit: it already knows
    // the row's static markup and already addresses the hole (the walk's `blankHere`).
    clone: `
    const scratch = document.createElement('template')
    scratch.innerHTML = '<li><span>x</span></li>'
    const shape = scratch.content.firstChild
    const next = []
    for (let at = 0; at < ${ROWS}; at += 1) {
        const row = shape.cloneNode(true)
        row.firstChild.firstChild.nodeValue = 'new ' + at
        next.push(row)
    }
    list.replaceChildren(...next)`,
}

function vanillaScript(body: string): string {
    return `
const list = document.querySelector('#list')
document.querySelector('#replace').addEventListener('click', () => {
    performance.mark('${LAYER_VANILLA}:opened')
${body}
    performance.measure('${LAYER_VANILLA}', '${LAYER_VANILLA}:opened')
})
`
}

type Sample = {
    opNanoseconds: number
    layerNanoseconds: number
    layerRuns: number
    share: number | null
    refusal: string
    recalcStyle: number
    layoutCount: number
}

async function traceArm(
    page: Page,
    button: string,
    layer: string,
): Promise<Sample> {
    const trace = await traceOp(page, 'reorder-to-paint', async () => {
        await page.evaluate(
            async ([id, layerName]) => {
                const lane = globalThis as unknown as { __FLUSH__?: () => void }
                performance.mark('op:start')
                ;(document.querySelector(`#${id}`) as HTMLElement).click()
                // THE TURN ENDS INSIDE THE OP. A reactive drain is batched to the end of one, so a
                // body that clicks and returns is measured before the reconcile has run at all —
                // and reports a page doing no work as a page doing less of it. The hand-written
                // arm has nothing to flush, which is itself part of what is being compared.
                lane.__FLUSH__?.()
                // THE LAYER'S OWN MEASURE IS THE COMPLETION SIGNAL, rather than a row's text.
                // Watching text cannot serve an arm whose rows are STATIC — the decomposition
                // below has one — and it silently waits forever instead of failing. Every arm
                // here emits a measure when its work is done, so one signal serves them all.
                await new Promise<void>((resolve) => {
                    const tick = (): void => {
                        if (
                            performance.getEntriesByName(layerName as string)
                                .length > 0
                        )
                            requestAnimationFrame(() => resolve())
                        else requestAnimationFrame(tick)
                    }
                    requestAnimationFrame(tick)
                })
                performance.mark('op:end')
                performance.measure('reorder-to-paint', 'op:start', 'op:end')
            },
            [button, layer] as [string, string],
        )
    })

    const op = trace.measures.find(
        (measure) => measure.name === 'reorder-to-paint',
    )
    if (!op) throw new Error('no reorder-to-paint measure')
    let layerNanoseconds = 0
    let layerRuns = 0
    for (const measure of trace.measures)
        if (measure.name === layer) {
            layerNanoseconds +=
                measure.endNanoseconds - measure.startNanoseconds
            layerRuns += 1
        }
    let share: number | null = null
    let refusal = ''
    try {
        share = shares(trace, {
            layer,
            of: 'reorder-to-paint',
            threshold: 'frame',
        }).ceilingCpu
    } catch (thrown) {
        refusal = String(thrown).split('\n')[0] ?? ''
    }
    return {
        opNanoseconds: op.endNanoseconds - op.startNanoseconds,
        layerNanoseconds,
        layerRuns,
        share,
        refusal,
        recalcStyle: trace.counters.recalcStyle,
        layoutCount: trace.counters.layout,
    }
}

// A WIDER ROW, AND NOTHING ELSE CHANGED. If `make` really is ~90% of the build then the build
// tracks the row's MARKUP SIZE, because parsing is the only thing in it that scales that way —
// the Scope, the row record, the keyed entry and the insert loop are per ROW, not per byte. This
// is the instrument-free check on a claim that currently rests on an instrumented run whose
// absolutes were distorted by six `performance` calls a row.
const WIDE_SOURCE = PAGE_SOURCE.replace(
    '<li><span>{row.label}</span></li>',
    '<li><span>{row.label}</span><span>b</span><span>c</span><span>d</span><span>e</span><span>f</span></li>',
)

const compiled = await buildCompiledPage(PAGE_SOURCE)
const compiledStatic = await buildCompiledPage(STATIC_SOURCE)
const compiledWide = await buildCompiledPage(WIDE_SOURCE)

const byCase: Record<string, Sample[]> = {
    reverse: [],
    swap: [],
    replace: [],
    append: [],
    clear: [],
    'replace (static rows)': [],
    'replace (hand-written)': [],
    'replace (innerHTML a row)': [],
    'replace (parse once, clone)': [],
    'replace (painter, one shape)': [],
    'replace (painter, two shapes)': [],
    'ladder: +insert each node': [],
    'ladder: +a Scope a row': [],
    'ladder: +row record and keyed map': [],
    'ladder: abide make reproduced': [],
    'replace (wide row)': [],
    'ONE parse for the whole tree': [],
}

const browser = await chromium.launch()
try {
    for (let run = 0; run < RUNS; run += 1) {
        for (const which of [
            'reverse',
            'swap',
            'replace',
            'append',
            'clear',
        ] as const) {
            const context = await browser.newContext()
            // Armed before the page's script runs — `measureLayer.ts` reads the flag once at
            // module load, so this must be an init script and not a later `evaluate`.
            await context.addInitScript(() => {
                ;(
                    globalThis as unknown as { __ABIDE_LAYERS__: boolean }
                ).__ABIDE_LAYERS__ = true
            })
            const page = await context.newPage()
            await page.goto('about:blank')
            await page.setContent(
                `<!doctype html><html><body>${compiled.markup}</body></html>`,
            )
            await page.addScriptTag({ content: compiled.script })
            // MOUNTED OUTSIDE THE OP. Hydration is setup here, not the thing being priced, and
            // `traceOp` clears the marks it left before the op begins.
            await page.evaluate(() => {
                ;(
                    globalThis as unknown as { __MOUNT__?: () => void }
                ).__MOUNT__?.()
            })
            ;(byCase[which] as Sample[]).push(
                await traceArm(page, which, LAYER_RECONCILE),
            )
            await context.close()
        }

        // THE WIDE-ROW ARM, same everything but a row carrying six elements instead of one.
        {
            const context = await browser.newContext()
            await context.addInitScript(() => {
                ;(
                    globalThis as unknown as { __ABIDE_LAYERS__: boolean }
                ).__ABIDE_LAYERS__ = true
            })
            const page = await context.newPage()
            await page.goto('about:blank')
            await page.setContent(
                `<!doctype html><html><body>${compiledWide.markup}</body></html>`,
            )
            await page.addScriptTag({ content: compiledWide.script })
            await page.evaluate(() => {
                ;(
                    globalThis as unknown as { __MOUNT__?: () => void }
                ).__MOUNT__?.()
            })
            ;(byCase['replace (wide row)'] as Sample[]).push(
                await traceArm(page, 'replace', LAYER_RECONCILE),
            )
            await context.close()
        }

        // THE STATIC-ROW ARM, compiled by the same call from the same source with one substitution.
        {
            const context = await browser.newContext()
            await context.addInitScript(() => {
                ;(
                    globalThis as unknown as { __ABIDE_LAYERS__: boolean }
                ).__ABIDE_LAYERS__ = true
            })
            const page = await context.newPage()
            await page.goto('about:blank')
            await page.setContent(
                `<!doctype html><html><body>${compiledStatic.markup}</body></html>`,
            )
            await page.addScriptTag({ content: compiledStatic.script })
            await page.evaluate(() => {
                ;(
                    globalThis as unknown as { __MOUNT__?: () => void }
                ).__MOUNT__?.()
            })
            ;(byCase['replace (static rows)'] as Sample[]).push(
                await traceArm(page, 'replace', LAYER_RECONCILE),
            )
            await context.close()
        }

        // THE HAND-WRITTEN ARMS, EACH ITS OWN NAVIGATION. `setContent` keeps the JavaScript
        // context, so sharing a page with the compiled arm would leave `__MOUNT__` on the global
        // and abide mounted into a document with no anchors.
        const vanillaArms: [string, string][] = [
            ['replace (hand-written)', 'createElement'],
            ['replace (innerHTML a row)', 'innerHTML'],
            ['replace (parse once, clone)', 'clone'],
            ['replace (painter, one shape)', 'painter'],
            ['replace (painter, two shapes)', 'painterTwo'],
            ['ladder: +insert each node', 'ladderInsert'],
            ['ladder: +a Scope a row', 'ladderScope'],
            ['ladder: +row record and keyed map', 'ladderKeyed'],
            ['ladder: abide make reproduced', 'ladderFaithful'],
            ['ONE parse for the whole tree', 'oneParse'],
        ]
        for (const [label, body] of vanillaArms) {
            const context = await browser.newContext()
            const page = await context.newPage()
            await page.goto('about:blank')
            await page.setContent(
                `<!doctype html><html><body>${VANILLA_MARKUP}</body></html>`,
            )
            await page.addScriptTag({
                content: vanillaScript(VANILLA_BODIES[body] as string),
            })
            ;(byCase[label] as Sample[]).push(
                await traceArm(page, 'replace', LAYER_VANILLA),
            )
            await context.close()
        }
    }
} finally {
    await browser.close()
}

function median(values: number[]): number {
    const sorted = [...values].sort((left, right) => left - right)
    return sorted[Math.floor(sorted.length / 2)] as number
}

const HEADINGS: Record<string, string> = {
    reverse: `full reverse of ${ROWS} — every row SURVIVES, no template instantiated`,
    swap: 'two-row swap — the distinguishing edit',
    replace: `${ROWS} fresh keys — every row BUILT, this is template instantiation`,
    append: `${ROWS} rows APPENDED to ${ROWS} standing — built, nothing dropped`,
    clear: `all ${ROWS} rows REMOVED — dropped, nothing built`,
    'replace (static rows)': `${ROWS} fresh keys, STATIC row body — same build, no per-row binding`,
    'replace (wide row)': `${ROWS} fresh keys, WIDE row — six elements instead of one`,
    'ONE parse for the whole tree': `${ROWS} rows in ONE innerHTML — what a region FILL does`,
    'replace (hand-written)': `${ROWS} fresh keys, HAND-WRITTEN — createElement and one replaceChildren`,
    'replace (innerHTML a row)': `${ROWS} fresh keys, HAND-WRITTEN — innerHTML a row, which is what the emitter does`,
    'replace (parse once, clone)': `${ROWS} fresh keys, HAND-WRITTEN — parse the shape ONCE, clone and fill`,
    'replace (painter, one shape)': `${ROWS} fresh keys, HAND-WRITTEN — built through a CURSOR, one painter`,
    'replace (painter, two shapes)': `${ROWS} fresh keys, HAND-WRITTEN — built through a CURSOR, two painter shapes at each site`,
    'ladder: +insert each node': `LADDER — parse a row, then insert each node into the LIVE list`,
    'ladder: +a Scope a row': `LADDER — the above, and a Scope allocated a row`,
    'ladder: +row record and keyed map': `LADDER — the above, and the row record plus keyed bookkeeping`,
    'ladder: abide make reproduced': `LADDER — \`markupNodes\` + \`escapeText\` + \`rowOf\` reproduced faithfully`,
}

console.log(
    `\nTHE REORDER SHARE — chromium/V8, ${RUNS} runs, ${ROWS} keyed rows\n`,
)
for (const [which, samples] of Object.entries(byCase)) {
    const taken = samples
        .map((sample) => sample.share)
        .filter((share): share is number => share !== null)
    const opMilliseconds = median(samples.map((s) => s.opNanoseconds)) / 1e6
    console.log(`  ${HEADINGS[which]}`)
    console.log(
        `    op          median ${opMilliseconds.toFixed(2)} ms   layer ${(median(samples.map((s) => s.layerNanoseconds)) / 1e6).toFixed(2)} ms`,
    )
    // THE WORK, BESIDE THE TIME, AND READ FIRST. Identical work counts with a large ms gap is
    // never a difference in the layer being compared — it is a difference in what the two arms
    // were ASKED to do, and that has cost this repo two sessions before.
    // HOW MANY TIMES THE LAYER RAN IN ONE OP. `shares()` SUMS same-named measures, and so does the
    // total above — so a layer that runs twice reports twice the per-row cost with nothing saying
    // so. Printed because a per-row figure divided by the wrong count is the quietest way to be
    // wrong here.
    console.log(`    layer runs  ${median(samples.map((s) => s.layerRuns))}`)
    console.log(
        `    work        recalcStyle ${median(samples.map((s) => s.recalcStyle))}   layout ${median(samples.map((s) => s.layoutCount))}`,
    )
    if (taken.length === 0)
        console.log(`    refused     ${samples[0]?.refusal}`)
    else {
        const sorted = [...taken].sort((left, right) => left - right)
        console.log(
            `    share       median ${(median(taken) * 100).toFixed(1)}%   spread ${((sorted[0] as number) * 100).toFixed(1)}% – ${((sorted[sorted.length - 1] as number) * 100).toFixed(1)}%`,
        )
    }
    console.log('')
}

const abideBuild = median(
    (byCase.replace as Sample[]).map((s) => s.layerNanoseconds),
)
const handBuild = median(
    (byCase['replace (hand-written)'] as Sample[]).map(
        (s) => s.layerNanoseconds,
    ),
)
const parsedPerRow = median(
    (byCase['replace (innerHTML a row)'] as Sample[]).map(
        (s) => s.layerNanoseconds,
    ),
)
const clonedOnce = median(
    (byCase['replace (parse once, clone)'] as Sample[]).map(
        (s) => s.layerNanoseconds,
    ),
)
console.log(
    `  BUILDING ${ROWS} ROWS costs abide ${(abideBuild / handBuild).toFixed(2)}x the hand-written arm ` +
        `(${(abideBuild / 1e6).toFixed(2)} ms against ${(handBuild / 1e6).toFixed(2)} ms).`,
)
// READ THE ASK BEFORE THE RATIO. The work counters above are IDENTICAL — one style recalculation
// and one layout in both arms — and CLAUDE.md is explicit that identical work with a large ms gap
// is a difference in what the two arms were ASKED to do, not in the layer being compared. It is
// here too, and the difference is not hidden: abide builds 500 rows each carrying a SCOPE and a
// binding, stops the 500 scopes it is replacing, and keeps the keyed bookkeeping that makes the
// reverse above cost 0.5 ms. The hand-written arm creates 500 static elements and can do none of
// that — a targeted update or a state-preserving move is not available to it at any price.
//
// SO THE RATIO IS NOT "ABIDE'S DOM IS 15x SLOWER". What it is, and it is worth more than a
// like-for-like number would be, is an EXISTENCE PROOF with the DOM half priced: 500 rows of this
// exact shape are materialisable in 0.7 ms, so the remaining ~10 ms is reactive construction and
// teardown rather than anything the document required. That is the fraction to decompose next,
// and until it is decomposed nobody should name the allocator or the effect as the target.
const staticBuild = median(
    (byCase['replace (static rows)'] as Sample[]).map(
        (s) => s.layerNanoseconds,
    ),
)
console.log(
    `  Of that, ${(handBuild / 1e6).toFixed(2)} ms is DOM the document needed either way.`,
)
// THE SPLIT, AND IT IS THE POINT OF THE STATIC ARM. Three numbers over one op: what the document
// costs, what abide's row machinery costs with no binding in the row, and what a binding a row
// adds. Naming the target without this split is the mistake the two no-op reactive-core rewrites
// made.
const appendBuild = median(
    (byCase.append as Sample[]).map((s) => s.layerNanoseconds),
)
const clearDrop = median(
    (byCase.clear as Sample[]).map((s) => s.layerNanoseconds),
)
// BUILD AGAINST TEARDOWN, isolated the same way: an append BUILDS and drops nothing, a clear DROPS
// and builds nothing, and a replace does both. If the two halves add up to the replace then the
// split is clean and neither is hiding inside the other.
console.log(
    `  BUILD AGAINST TEARDOWN, ${ROWS} rows each:\n` +
        `    build only (append)              ${(appendBuild / 1e6).toFixed(2)} ms\n` +
        `    teardown only (clear)            ${(clearDrop / 1e6).toFixed(2)} ms\n` +
        `    both (replace)                   ${(abideBuild / 1e6).toFixed(2)} ms   ` +
        `against ${((appendBuild + clearDrop) / 1e6).toFixed(2)} ms for the two halves added`,
)
console.log(
    `  THE SPLIT, ${ROWS} rows built:\n` +
        `    DOM the document needed          ${(handBuild / 1e6).toFixed(2)} ms\n` +
        `    abide row machinery, no binding  ${(staticBuild / 1e6).toFixed(2)} ms  (${(staticBuild / handBuild).toFixed(1)}x the DOM alone)\n` +
        `    one binding a row, on top        ${((abideBuild - staticBuild) / 1e6).toFixed(2)} ms  (${(((abideBuild - staticBuild) / abideBuild) * 100).toFixed(0)}% of abide's build)`,
)
// WHERE THE ROW BUILD GOES, attributed by three hand-written arms rather than by reading the
// emitter and guessing. `ls0_make` is `markupNodes(root, "<li>…")` and `parseMarkup` sets
// `template.innerHTML` — one HTML parse a row. The middle arm is that, alone.
const painterOne = median(
    (byCase['replace (painter, one shape)'] as Sample[]).map(
        (s) => s.layerNanoseconds,
    ),
)
const painterTwo = median(
    (byCase['replace (painter, two shapes)'] as Sample[]).map(
        (s) => s.layerNanoseconds,
    ),
)
console.log(
    `\n  WHERE THE ${ROWS}-ROW BUILD GOES, per row:\n` +
        `    createElement, inline            ${((handBuild / ROWS) * 1e-3).toFixed(1)} µs\n` +
        `    parse once, clone and fill       ${((clonedOnce / ROWS) * 1e-3).toFixed(1)} µs\n` +
        `    through a cursor, one shape      ${((painterOne / ROWS) * 1e-3).toFixed(1)} µs\n` +
        `    through a cursor, two shapes     ${((painterTwo / ROWS) * 1e-3).toFixed(1)} µs\n` +
        `    innerHTML a row (the emitter)    ${((parsedPerRow / ROWS) * 1e-3).toFixed(1)} µs\n` +
        `    abide's whole make+mount         ${((abideBuild / ROWS) * 1e-3).toFixed(1)} µs`,
)
// THE OBJECTION, PRICED. Axis 4's fallback builds through a cursor, and the standing worry is that
// dispatch per position eats what the string round trip gave back. These two rows are that worry
// with a number on it: the gap between inline construction and a two-shape call site is the whole
// of what the redesign's RUNTIME shape costs.
const ladder: [string, string][] = [
    ['parse a row + replaceChildren', 'replace (innerHTML a row)'],
    ['  + insert each node live', 'ladder: +insert each node'],
    ['  + a Scope a row', 'ladder: +a Scope a row'],
    ['  + row record and keyed map', 'ladder: +row record and keyed map'],
    ['  = abide make, reproduced', 'ladder: abide make reproduced'],
]
// THE LADDER, EACH RUNG A DELTA. Attribution by adding one thing at a time to a hand-written arm,
// which is the only way to reach these without a per-row timer the clock cannot resolve. The last
// rung against abide's own number is what is STILL unexplained.
let previous = 0
console.log(`\n  WHAT THE ${ROWS}-ROW BUILD IS MADE OF, per row:`)
for (const [label, key] of ladder) {
    const here = median(
        (byCase[key] as Sample[]).map((s) => s.layerNanoseconds),
    )
    const perRow = (here / ROWS) * 1e-3
    const delta = previous === 0 ? 0 : ((here - previous) / ROWS) * 1e-3
    console.log(
        `    ${label.padEnd(30)} ${perRow.toFixed(1)} µs${previous === 0 ? '' : `   (+${delta.toFixed(1)})`}`,
    )
    previous = here
}
// ABIDE SITS BELOW THE LADDER NOW, and that is the change having landed rather than a
// measurement error: the rungs price the PARSE path a row used to take, and a constructed row does
// not take it. Kept as the comparison it now is — what the client used to pay, against what it
// pays.
console.log(
    `    ${'abide make+mount (built)'.padEnd(30)} ${((abideBuild / ROWS) * 1e-3).toFixed(1)} µs   (${(abideBuild / previous).toFixed(2)}x the parse path it replaced)`,
)
const wideBuild = median(
    (byCase['replace (wide row)'] as Sample[]).map((s) => s.layerNanoseconds),
)
// THE SCALING CHECK, AND ITS SIGNATURE IS THE WHOLE STORY. One element a row against six: the
// markup roughly quadruples and everything per-ROW is unchanged. While the emitter PARSED, this
// read 1.12x over three runs and two list sizes — a cost ~88% fixed per row, which is what
// invoking a parser looks like. Constructed, it reads ~2x: the cost became proportional to the
// nodes actually made, which is what construction looks like. A flat reading here again would mean
// a fixed per-row cost had come back.
console.log(
    `\n  DOES THE BUILD TRACK THE MARKUP? one element a row ${(abideBuild / 1e6).toFixed(2)} ms, ` +
        `six ${(wideBuild / 1e6).toFixed(2)} ms — ${(wideBuild / abideBuild).toFixed(2)}x for ~4x the markup bytes.`,
)
console.log(
    `\n  DISPATCH, against inline construction: one shape ${(painterOne / handBuild).toFixed(2)}x, ` +
        `two shapes ${(painterTwo / handBuild).toFixed(2)}x. The emitter's string round trip is ` +
        `${(parsedPerRow / handBuild).toFixed(2)}x the same baseline.`,
)
// WHAT CONSTRUCTION IS WORTH, against the two arms that bound it: the parse path the emitter used
// to take, and hand-written `createElement`, which is the floor.
const oneParse = median(
    (byCase['ONE parse for the whole tree'] as Sample[]).map(
        (s) => s.layerNanoseconds,
    ),
)
// THE QUESTION A ROW RESULT CANNOT ANSWER. Construction wins on a row because the parser's FIXED
// cost dominates a forty-byte string. A region fill is one parse of the whole tree — so this is
// whether the same trade holds when the fixed cost is amortised over everything at once.
console.log(
    `\n  ONE PARSE OF ${ROWS} ROWS: ${(oneParse / 1e6).toFixed(2)} ms, against ` +
        `${(handBuild / 1e6).toFixed(2)} ms to CONSTRUCT the same tree ` +
        `(${(oneParse / handBuild).toFixed(2)}x) — and against ${(parsedPerRow / 1e6).toFixed(2)} ms parsing a row at a time.`,
)
console.log(
    `\n  ROW CONSTRUCTION vs THE PARSE PATH: ${(abideBuild / 1e6).toFixed(2)} ms against ` +
        `${(parsedPerRow / 1e6).toFixed(2)} ms at ${ROWS} rows — and the hand-written floor is ` +
        `${(handBuild / 1e6).toFixed(2)} ms, so abide is ${(abideBuild / handBuild).toFixed(2)}x a bare createElement loop ` +
        `with the Scope, the row record and the keyed bookkeeping inside it.`,
)
console.log(
    `\n  one frame = ${(THRESHOLDS.frame / 1e6).toFixed(2)} ms. A share is WALL CLOCK between two marks and includes any style or layout the layer forced — it is not the script category.\n`,
)
