import { emitMarkup } from './emitComponent.ts'
import { hoistPaths } from './hoistPaths.ts'
import { lowerNames } from './lowerNames.ts'
import type { AbideFile } from './parseAbide.ts'
import {
    isSingleRooted,
    type ListPlan,
    planTemplate,
    type RegionPlan,
    type TemplatePlan,
    type TextRun,
} from './planTemplate.ts'
import { RUNTIME_SPECIFIER, SHARED_SPECIFIER } from './SPECIFIERS.ts'
import { splitImports } from './splitImports.ts'

// The client half of one `.abide`. It reads the SAME plan the server emitter did, so the position
// the server wrote to and the position the client walks to cannot drift.
//
// NOTHING IS ADDED TO THE DOCUMENT to make this work. A text run and a listener element are both
// reached by walking child indices from the region root, which is exact for a region whose shape
// is static — and a compiled template's is, up to the boundaries where 32.13, 32.14 and 32.16
// make it depend on a value. Those boundaries are where a marker will earn its place; nowhere
// before them does.
//
// 41.7 — hydration re-executes the setup, so the values the client starts from are the values the
// document was rendered with.

export function emitClient(
    file: AbideFile,
    reactive: ReadonlySet<string> = new Set(),
): string {
    const plan = planTemplate(
        file.template.filter(
            (node) => !(node.kind === 'element' && node.tag === 'head'),
        ),
    )
    const used = new Set<string>()
    const lines: string[] = []
    const helpers: string[] = []
    emitRegion(plan, 'root', '', reactive, lines, helpers, used, { next: 0 })
    if (lines.length === 0) return ''

    const setup = splitImports(lowerNames(file.scripts.join('\n'), reactive))
    // `watch` and the escaping are an APP's names (`abide`); everything else is the client
    // runtime's (`abide/runtime`).
    const fromShared = new Set(['watch', 'escapeText', 'escapeAttribute'])
    const shared = [...used].filter((name) => fromShared.has(name))
    const runtime = [...used].filter((name) => !fromShared.has(name))

    // `watch` is imported under a second name because an ARM's bindings are collected so they can
    // be stopped on a swap: inside an arm `watch` is a local that records the disposer, and
    // `watchEffect` is the real one underneath it.
    const names = shared
        .sort()
        .map((name) => (name === 'watch' ? 'watch as watchEffect' : name))
    const sharedImport =
        shared.length === 0
            ? ''
            : `import { ${names.join(', ')} } from '${SHARED_SPECIFIER}'\n`
    return `${sharedImport}import { ${runtime.sort().join(', ')} } from '${RUNTIME_SPECIFIER}'
${setup.imports}
export default function mount(root) {
${indent(setup.body)}
${indent(helpers.join('\n'))}
${indent(lines.join('\n'))}
}
`
}

// One region's bindings, emitted against `base` — the page for the outermost, and a `{#if}` arm's
// own anchor for a nested one. The arms of a block are emitted as their own functions so an arm's
// paths are its own: `[0,1]` in one arm and `[0,1]` in another are different nodes, and neither
// arm can reach the other's.
function emitRegion(
    plan: TemplatePlan,
    base: string,
    inside: string,
    reactive: ReadonlySet<string>,
    lines: string[],
    helpers: string[],
    used: Set<string>,
    counter: { next: number },
): void {
    const live = plan.runs.filter((run) => readsReactive(run, reactive))
    // A path through a REGION reference is not hoistable: its first step names a region rather
    // than a child, so a prefix ending there is not a node and an anchor at it would walk from
    // nothing. Those paths are emitted whole; only child-index paths are shared.
    const direct = (path: number[]): boolean => path.some((step) => step < 0)
    const hoisted = hoistPaths([
        ...live.map((run) => run.path).filter((path) => !direct(path)),
        ...plan.handlers
            .map((handler) => handler.path)
            .filter((path) => !direct(path)),
    ])

    const resolve = (path: number[]): string => {
        const at = hoisted.reference(path)
        return `${at.base}, ${JSON.stringify(at.rest)}`
    }

    for (const anchor of hoisted.anchors) {
        used.add('childAt')
        // `anchor.from` is a BASE, not a function: the walk itself is always `childAt`.
        lines.push(
            `const ${anchor.name} = ${step(
                'childAt',
                anchor.steps,
                anchor.from === 'root' ? base : anchor.from,
                inside,
                used,
                true,
            )}`,
        )
    }

    for (const run of live) {
        used.add('watch')
        used.add('setText')
        used.add('textAt')
        used.add('escapeless')
        const value = run.parts
            .map((part) =>
                part.kind === 'static'
                    ? JSON.stringify(part.text)
                    : `escapeless(${lowerNames(part.text, reactive)})`,
            )
            .join(' + ')
        const at = direct(run.path)
            ? { base: 'root', rest: run.path }
            : hoisted.reference(run.path)
        lines.push(
            `${inside === '' ? 'watchEffect' : 'watch'}(() => setText(${step('textAt', at.rest, at.base === 'root' ? base : at.base, inside, used, true)}, ${value}))`,
        )
    }

    for (const handler of plan.handlers) {
        used.add('elementAt')
        const at = direct(handler.path)
            ? { base: 'root', rest: handler.path }
            : hoisted.reference(handler.path)
        lines.push(
            `${step('elementAt', at.rest, at.base === 'root' ? base : at.base, inside, used, true)}.addEventListener(${JSON.stringify(
                handler.event,
            )}, ${lowerNames(handler.source, reactive)})`,
        )
    }

    for (const region of plan.regions)
        if (region.kind === 'for')
            emitList(
                region,
                base,
                inside,
                reactive,
                lines,
                helpers,
                used,
                counter,
            )
        else
            emitBlock(
                region,
                base,
                inside,
                reactive,
                lines,
                helpers,
                used,
                counter,
                resolve,
            )
}

// 32.13 — one arm renders. The SERVER already rendered one, so the first mount HYDRATES it rather
// than replacing it: a page that re-renders every region on load creates every node twice and
// throws away the document it was sent.
function emitBlock(
    region: RegionPlan,
    base: string,
    inside: string,
    reactive: ReadonlySet<string>,
    lines: string[],
    helpers: string[],
    used: Set<string>,
    counter: { next: number },
    _resolve: (path: number[]) => string,
): void {
    const name = `rg${counter.next}`
    counter.next += 1
    used.add('regionAt')
    used.add('fillRegion')
    used.add('watch')

    const parent =
        region.parent.length === 0
            ? base
            : `childAt(${base}, ${JSON.stringify(region.parent)})`
    if (region.parent.length > 0) used.add('childAt')
    lines.push(`const ${name} = regionAt(${parent}, ${region.index})`)

    // Which arm takes, as one expression. `{:else}` carries no condition and is the floor.
    let take = '-1'
    for (let at = region.branches.length - 1; at >= 0; at -= 1) {
        const branch = region.branches[at] as (typeof region.branches)[number]
        take =
            branch.subject === ''
                ? String(at)
                : `(${lowerNames(branch.subject, reactive)}) ? ${at} : ${take}`
    }

    // Each arm's markup, for the swap. The server's own emitter is not reachable here, so the
    // client carries its own copy of each arm's markup — which is why `escapeText` is in #shared.
    const armHtml: string[] = []
    const armMount: string[] = []
    for (let at = 0; at < region.branches.length; at += 1) {
        const branch = region.branches[at] as (typeof region.branches)[number]
        const armLines: string[] = []
        emitRegion(
            branch.plan,
            name,
            name,
            reactive,
            armLines,
            helpers,
            used,
            counter,
        )
        armMount.push(
            `    if (arm === ${at}) {\n${armLines.map((line) => `        ${line}`).join('\n')}\n    }`,
        )
        const markup = emitMarkup(branch.children, reactive)
        if (markup.includes('escapeText(')) used.add('escapeText')
        if (markup.includes('escapeAttribute(')) used.add('escapeAttribute')
        armHtml.push(`    if (arm === ${at}) return ${markup}`)
    }

    // EVERY BINDING AN ARM OPENS IS COLLECTED, and the arm it replaces is stopped. Without it a
    // swap leaves the old arm's readers alive: they wake on every write, write into nodes that
    // are no longer in the document, and the page looks right while doing the work twice.
    helpers.push(
        `const ${name}_mount = (${name}, arm) => {\n    const stops = []\n    const watch = (effect) => { stops.push(watchEffect(effect)) }\n${armMount.join('\n')}\n    return () => { for (const stop of stops) stop() }\n}`,
    )

    lines.push(`let ${name}_at = ${take}`)
    lines.push(`let ${name}_stop = ${name}_mount(${name}, ${name}_at)`)
    lines.push(`${inside === '' ? 'watchEffect' : 'watch'}(() => {
    const next = ${take}
    if (next === ${name}_at) return
    ${name}_at = next
    ${name}_stop()
    fillRegion(${name}, ${name}_html(next))
    ${name}_stop = ${name}_mount(${name}, next)
})`)
    helpers.push(
        `function ${name}_html(arm) {\n${armHtml.join('\n')}\n    return ''\n}`,
    )
}

// 32.14 — the list. The server already rendered the rows, so the first mount HYDRATES them:
// every row's element is already in the document and only its bindings are missing. Only a change
// to the list reconciles, and only the rows that moved move.
//
// 32.23 — the subject is read ONCE for the block. 32.24 — an absent subject iterates zero times.
function emitList(
    region: ListPlan,
    base: string,
    inside: string,
    reactive: ReadonlySet<string>,
    lines: string[],
    helpers: string[],
    used: Set<string>,
    counter: { next: number },
): void {
    const name = `ls${counter.next}`
    counter.next += 1
    for (const runtime of ['regionAt', 'rowsIn', 'reconcile'] as const)
        used.add(runtime)
    used.add('watch')

    const parent =
        region.parent.length === 0
            ? base
            : `childAt(${base}, ${JSON.stringify(region.parent)})`
    if (region.parent.length > 0) used.add('childAt')

    const subject = lowerNames(region.subject, reactive)
    const at = region.at === '' ? '__at' : region.at
    // 41.9 — with no `by`, the key is the POSITION, which is 32.14's positional reconcile: a row
    // is whatever is in that slot, and a reorder rewrites the rows rather than moving them.
    const key =
        region.key === ''
            ? '__at'
            : lowerNames(region.key, reactive).replaceAll(
                  new RegExp(`\\b${region.item}\\b`, 'g'),
                  '__row',
              )

    // The row's own bindings, against the row element the server wrote or the reconcile made.
    const single = isSingleRooted(region.children)
    const rowMarkup = emitMarkup(region.children, reactive).replaceAll(
        new RegExp(`\\b${region.item}\\b`, 'g'),
        '__row',
    )
    if (rowMarkup.includes('escapeText(')) used.add('escapeText')
    if (rowMarkup.includes('escapeAttribute(')) used.add('escapeAttribute')

    const rowLines: string[] = []
    emitRegion(
        region.plan,
        '__node',
        '',
        reactive,
        rowLines,
        helpers,
        used,
        counter,
    )

    helpers.push(
        [
            `const ${name}_list = () => { const __l = ${subject}; return __l == null ? [] : [...__l] }`,
            `const ${name}_key = (__row, __at) => ${key.replaceAll('__at', '__at')}`,
            // EVERY node the body produced, not just the first. A multi-rooted row also gets its
            // anchor, so what `make` hands back matches what `rowsIn` found.
            `const ${name}_make = (__row, ${at}) => { const __t = document.createElement('template'); __t.innerHTML = ${single ? rowMarkup : `'<!--${'r'}-->' + ${rowMarkup}`}; return [...__t.content.childNodes] }`,
            `const ${name}_mount = (__nodes, __row, ${at}) => {`,
            `    const __node = __nodes[${single ? '0' : '1'}]`,
            `    const stops = []`,
            `    const watch = (effect) => { stops.push(watchEffect(effect)) }`,
            ...rowLines.map((line) => `    ${line}`),
            `    return () => { for (const stop of stops) stop() }`,
            `}`,
        ].join('\n'),
    )

    lines.push(`const ${name} = regionAt(${parent}, ${region.index})`)
    // HYDRATION, NOT RENDERING. The rows are already there; wiring them is all that is left.
    lines.push(`let ${name}_rows = rowsIn(${name}, ${single ? 'false' : 'true'}).map((__nodes, __i) => {
    const __row = ${name}_list()[__i]
    return { key: ${name}_key(__row, __i), data: __row, nodes: __nodes, stop: ${name}_mount(__nodes, __row, __i) }
})`)
    lines.push(`${inside === '' ? 'watchEffect' : 'watch'}(() => {
    const __l = ${name}_list()
    ${name}_rows = reconcile(
        ${name},
        ${name}_rows,
        __l.map((__row, __i) => ${name}_key(__row, __i)),
        __l,
        (__i) => ${name}_make(__l[__i], __i),
        (__nodes, __i) => ${name}_mount(__nodes, __l[__i], __i),
    )
})`)
}

// A path step, rendered against whatever this region's base is. A NEGATIVE first step is a
// reference to a sibling region: `-1 - n` is region n in this parent, and the step after it is
// how many nodes past its closing anchor to count.
function step(
    fn: string,
    path: number[],
    base: string,
    inside: string,
    used: Set<string>,
    checked = false,
): string {
    if (inside !== '' && base === inside) {
        // Inside an arm, the first index counts from the region's OPENING anchor.
        used.add('insideRegion')
        const [first, ...rest] = path
        const node = `insideRegion(${inside}, ${first ?? 0})`
        return rest.length === 0 && !checked
            ? node
            : `${fn}(${node}, ${JSON.stringify(rest)})`
    }
    const first = path[0]
    if (first !== undefined && first < 0) {
        used.add('regionAt')
        used.add('afterRegion')
        const region = -1 - first
        const offset = path[1] ?? 0
        const node = `afterRegion(regionAt(${base}, ${region}), ${offset})`
        return `${fn}(${node}, ${JSON.stringify(path.slice(2))})`
    }
    return `${fn}(${base}, ${JSON.stringify(path)})`
}

// Whether any expression in the run reads a name the checker called reactive. A run of static
// parts and unreactive expressions is written once by the server and never again; opening a
// binding for it is one waking reader per run on a page for nothing.
function readsReactive(run: TextRun, reactive: ReadonlySet<string>): boolean {
    for (const part of run.parts) {
        if (part.kind !== 'expression') continue
        if (lowerNames(part.text, reactive) !== part.text) return true
    }
    return false
}

function indent(text: string): string {
    const lines = text.split('\n')
    let out = ''
    for (const line of lines) out += line.trim() === '' ? '\n' : `    ${line}\n`
    return out.trimEnd()
}
