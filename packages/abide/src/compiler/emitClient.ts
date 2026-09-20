import type { Read } from './classifyRead.ts'
import { emitMarkup, emitRow, importClause, SHARED } from './emitComponent.ts'
import { hoistPaths } from './hoistPaths.ts'
import { Lowering, PROPS } from './Lowering.ts'
import type { AbideFile } from './parseAbide.ts'
import {
    type ComponentPlan,
    isHead,
    isSingleRooted,
    type ListPlan,
    planTemplate,
    type RegionPlan,
    type TemplatePlan,
    type TextRun,
} from './planTemplate.ts'
import { SHARED_NAMES } from './SHARED_NAMES.ts'
import { RUNTIME_SPECIFIER, SHARED_SPECIFIER } from './SPECIFIERS.ts'
import { componentImports, splitImports, withoutProps } from './splitImports.ts'

// The client half of one `.abide`. It reads the SAME plan the server emitter did, so the position
// the server wrote to and the position the client walks to cannot drift.
//
// NOTHING IS ADDED TO THE DOCUMENT to make this work. A text run and a listener element are both
// reached by walking child indices from the region root, which is exact for a region whose shape
// is static — and a compiled template's is, up to the boundaries where 32.13, 32.14 and 32.16
// make it depend on a value. Those boundaries are where a marker earns its place; nowhere before
// them does.
//
// 41.7 — hydration re-executes the setup, so the values the client starts from are the values the
// document was rendered with.

// What the emitters thread through every region: the next region's number, and whether anything
// LIVE has been emitted anywhere in the page.
type Counter = { next: number; live: boolean }

// `invoked` is whether another file invokes this one as a component (32.19). Only then can this
// module be mounted against an EMPTY region — a row a list grew by — and only then does it carry
// its own markup. A page is never invoked, and a page carrying a second copy of its template is
// 34% more client than it needs: measured at 1797 -> 2405 shipped lines over the corpus with every
// file carrying one. WHICH FILES ARE INVOKED IS THE BUILD'S KNOWLEDGE, being a fact about the
// import graph rather than about this file, so it arrives rather than being guessed here.
export function emitClient(
    file: AbideFile,
    reads: readonly Read[] = [],
    invoked = true,
): string {
    const plan = planTemplate(file.template.filter((node) => !isHead(node)))
    const lowering = new Lowering(file, reads)
    const used = lowering.used
    const lines: string[] = []
    const helpers: string[] = []
    const counter = { next: 0, live: false }
    emitRegion(plan, 'root', lowering, lines, helpers, counter)
    // NOTHING LIVE IS NO MODULE. `lines.length === 0` stopped meaning that the moment a BLANK run
    // started being addressed whether or not it reads anything reactive: a page whose only
    // expression is `{new Date().getFullYear()}` emitted a `mount` holding one `textAt` and
    // nothing else, so `bin/abide.ts` wrote a `.client.ts` beside a page that has nothing to
    // hydrate — and "this page ships no runtime" stopped being a fact about the build. A blank
    // address is only load-bearing because a LATER index counts through it, so with no binding,
    // no listener and no region anywhere in the page there is nothing for it to hold a place for.
    if (!counter.live) return ''
    const warnMismatch = lowering.use('warnMismatch')
    const scope = lowering.use('Scope')

    // 34.2 — A `<script module>` IS PROCESS-WIDE IN A BROWSER, which is MODULE SCOPE: it is
    // evaluated once when this module is first imported rather than once per `mount`, so a second
    // mount of the same page reads what the first one left.
    const moduleSetup = splitImports(lowering.modules())
    const setup = splitImports(lowering.scripts())
    // 32.19 IN A ROW — what a CALLER's client calls to build markup for a row the server never
    // wrote. The same template the server emitter writes, emitted a second time into this module,
    // which is the scheme an `{#if}` arm and a `{#for}` row already use for their own markup. It
    // hangs off `mount` rather than being a second export, so the caller's own
    // `import Row from './Row.abide'` reaches both halves.
    //
    // A PAGE SHIPS ONE TOO, and nothing calls it: which files are INVOKED is the build's knowledge
    // (see `bin/abide.ts`), not this emitter's. The markup is a string concatenation over the same
    // template this module already holds — the cost is the template's own bytes, once.
    const body = invoked
        ? emitMarkup(
              file.template.filter((node) => !isHead(node)),
              lowering,
              true,
          )
        : "''"
    // 32.19 — A COMPONENT FILLS ITS OWN REGION where the server wrote none. A row the list grew by
    // is built in the browser, and the child's markup is in the child's SERVER module — which the
    // browser may not reach. So the caller writes the anchor pair alone and the child fills it
    // from the template this module already holds, once, inside the instance whose setup just ran.
    // Rendering it from the caller instead would mean the child's setup running twice per row: one
    // run for the markup and another for the bindings.
    const fills =
        !invoked || body === "''"
            ? ''
            : `if (${lowering.use('isEmptyRegion')}(root)) ${lowering.use('fillRegion')}(root, ${body})\n`

    // 10.5 on the other side, and the same scope: the child's `mount` is called from inside the
    // parent's, so the chain a key is looked up is the component tree here too.
    // 10.5 — CAPTURED WHERE A DEFERRED MOUNT CAN NEED IT. A row or an arm mounted after the fact
    // runs from a `watch` effect, with nothing on the stack; this is the scope it resumes.
    const captured = holdsComponent(plan)
        ? `const ${SHARE_AT} = ${lowering.use('currentShare')}()\n`
        : ''
    const shares = lowering.opensShareScope()
    const opened = shares
        ? `const ${SHARED} = ${lowering.use('enterShare')}()\ntry {\n`
        : ''
    const closed = shares
        ? `\n} finally { ${lowering.use('leaveShare')}(${SHARED}) }`
        : ''
    // The escaping is an APP's (`abide`); everything else is the client runtime's (`abide/runtime`).
    const shared: string[] = []
    const runtime: string[] = []
    for (const name of used)
        (SHARED_NAMES.has(name) ? shared : runtime).push(name)

    const sharedImport =
        shared.length === 0
            ? ''
            : `import { ${importClause(shared.sort())} } from '${SHARED_SPECIFIER}'\n`
    // THE SETUP IS NOT RE-INDENTED. Adding a margin to every line rewrites the INSIDE of a
    // multi-line template literal, so a string constant gains four spaces it never had.
    // 41.11 — A MISMATCH MUST NOT REBUILD THE PAGE, and the page is the one region with no block
    // around it. So the root's own bindings warn and stop rather than rebuilding, while every
    // block inside rebuilds itself; an author's own throw is not a mismatch and comes straight
    // back out.
    //
    // THE PAGE OPENS A SCOPE LIKE EVERY ARM AND ROW, and nothing ever stops it: the page's
    // bindings live as long as the page. One object a page buys one way of opening a binding.
    return `${sharedImport}import { ${importClause(runtime.sort())} } from '${RUNTIME_SPECIFIER}'
${componentImports(withoutProps(moduleSetup.imports), '.client')}${componentImports(withoutProps(setup.imports), '.client')}
${moduleSetup.body === '' ? '' : `${moduleSetup.body}\n`}\
export default function mount(root${lowering.takesProps() ? `, ${PROPS} = {}` : ''}) {
${opened}${setup.body}
${helpers.join('\n')}
${fills}${captured}${fills}const ${SCOPE} = new ${scope}()
try {
${lines.join('\n')}
} catch (thrown) { if (!${warnMismatch}(thrown)) throw thrown }
return ${SCOPE}${closed}
}
`
}

// One region's bindings, emitted against its own root. The arms of a block are emitted as their
// own functions so an arm's paths are its own: `[0,1]` in one arm and `[0,1]` in another are
// different nodes, and neither arm can reach the other's.
//
// A REGION'S ROOT IS NOT ALWAYS A NODE. The page's is — `mount(root)` is handed one — but a
// `{#if}` arm's children hang off its own anchors and a `{#for}` row's are the nodes the reconcile
// handed back, and neither has an element that contains them. Every addressing helper takes all
// three, so which kind a root is belongs to the runtime and is not a case here: the emitter hands
// over the root's NAME and a path, whatever the root turned out to be.
function emitRegion(
    plan: TemplatePlan,
    root: string,
    lowering: Lowering,
    lines: string[],
    helpers: string[],
    counter: Counter,
): void {
    const live = new Set<TextRun>()
    for (const run of plan.runs) if (readsReactive(run, lowering)) live.add(run)
    // A path through a REGION reference shares only what stands BEFORE the reference: a prefix
    // that ends between the two numbers a reference is written as addresses nothing, so an anchor
    // there would walk from nowhere. Cut at the first reference, the rest of the path is shared
    // like any other.
    const sharable: number[][] = []
    for (const run of live) sharable.push(beforeRegion(run.path))
    for (const handler of plan.handlers)
        sharable.push(beforeRegion(handler.path))
    // Where a path is walked from: its nearest anchor, or the region's own root.
    const hoisted = hoistPaths(sharable, root)

    // ADDRESSED IN DOCUMENT ORDER, WITH THE ANCHORS INTERLEAVED rather than emitted ahead of
    // everything. A BLANK run renders no node at all when its value is empty, and `textAt` puts
    // one back on the run that resolves it — until it does, every index after that position in
    // the same parent is short by one, an ANCHOR's walk included. Lexicographic path order is
    // document order, and a run that shifts an index always sorts before what it shifts, so one
    // sort is the whole of the ordering.
    const addresses: { path: number[]; text: string }[] = []

    // `anchor.from` is a BASE, not a function: the walk itself is always `childAt`.
    for (const anchor of hoisted.anchors)
        addresses.push({
            path: anchor.path,
            text: `const ${anchor.name} = ${step(
                'childAt',
                anchor.steps,
                anchor.from,
                lowering,
            )}`,
        })

    for (const run of plan.runs) {
        const bound = live.has(run)
        // A run reading nothing reactive opens no binding — but a BLANK one still has to be
        // resolved, because the node it is missing is what every later index in that parent
        // counts through. Nothing else about it is ever read again.
        if (!bound && !run.blank) continue
        const at = hoisted.reference(run.path)
        const address = step(
            'textAt',
            at.rest,
            at.base,
            lowering,
            true,
            run.blank,
        )
        if (!bound) {
            addresses.push({ path: run.path, text: address })
            continue
        }
        counter.live = true
        const escapeless = lowering.use('escapeless')
        const value = run.parts
            .map((part) =>
                part.holder === null
                    ? JSON.stringify(part.text)
                    : `${escapeless}(${lowering.slot(part.holder)})`,
            )
            .join(' + ')
        // RESOLVED ONCE, AT ITS ADDRESS'S PLACE IN THE ORDER, and the binding closes over the node.
        // The node a path lands on is the same one on every run — `textAt` puts a blank run's
        // back on the first and `setText` never removes it — so re-walking the path per write was
        // the same answer bought again: measured in Chromium at 0.47 µs a write against 0.22 µs
        // with the node held, the walk alone 0.21 µs of it, over two runs of 80,000 writes.
        const node = `__t${run.path.join('_').replaceAll('-', 'm')}`
        addresses.push({
            path: run.path,
            text: `const ${node} = ${address}\n${SCOPE}.watch(() => ${lowering.use('setText')}(${node}, ${value}))`,
        })
    }

    addresses.sort(byPath)
    for (const address of addresses) lines.push(address.text)

    for (const handler of plan.handlers) {
        counter.live = true
        const at = hoisted.reference(handler.path)
        lines.push(
            `${step('elementAt', at.rest, at.base, lowering)}.addEventListener(${JSON.stringify(
                handler.event,
            )}, ${lowering.expression(handler.attribute)})`,
        )
    }

    for (const region of plan.regions)
        if (region.kind === 'for')
            emitList(region, root, lowering, lines, helpers, counter)
        else if (region.kind === 'component')
            emitInvocation(region, root, lowering, lines, counter)
        else emitBlock(region, root, lowering, lines, helpers, counter)
}

// Whether a component is invoked anywhere below this plan, which is what decides whether a
// deferred mount has to resume its instance's share scope (10.5). Walked rather than flagged: a
// component three regions down is as much a descendant as one in the page's own template.
function holdsComponent(plan: TemplatePlan): boolean {
    for (const region of plan.regions) {
        if (region.kind === 'component') return true
        if (region.kind === 'for') {
            if (holdsComponent(region.plan)) return true
            continue
        }
        for (const branch of region.branches)
            if (holdsComponent(branch.plan)) return true
    }
    return false
}

// A path cut at its first region reference, the reference's own first number kept, so every
// PROPER prefix `hoistPaths` counts is one a walk can stop at.
function beforeRegion(path: number[]): number[] {
    for (let at = 0; at < path.length; at += 1)
        if ((path[at] as number) < 0) return path.slice(0, at + 1)
    return path
}

// A region's bindings go through its SCOPE, so what replaced the region can stop them (see
// `Scope`). In the framework's own `__` namespace because a row binds the AUTHOR's item name as a
// parameter in the same scope.
const SCOPE = '__scope'

// The share scope an instance captures for its deferred mounts (10.5), named apart from the one an
// instance OPENS (`SHARED`): a page that shares nothing still carries this for a child that does.
const SHARE_AT = '__shareAt'

// 41.11 — A MISMATCH REBUILDS THIS BLOCK OR ROW AND NOTHING WIDER. What the server wrote is what
// hydration walks; where it disagrees, it is re-rendered from the same markup a swap or a new row
// uses (`rebuild`) and wired again. `__rebuilt` is what stops a document that disagrees for some
// other reason from rebuilding forever — the second failure is the author's to see.
function mountFunction(
    name: string,
    parameters: string,
    body: string[],
    rebuild: string,
    lowering: Lowering,
    resumes = false,
): string {
    return [
        `const ${name}_mount = (${parameters}, __rebuilt) => {`,
        // 10.5 — the instance's own scope, put back for a mount that happens later than its
        // caller's. Only where a component stands below this region: nothing else can read it.
        ...(resumes
            ? [
                  `    const __back = ${lowering.use('resumeShare')}(${SHARE_AT})`,
                  `    try {`,
              ]
            : []),
        `    const ${SCOPE} = new ${lowering.use('Scope')}()`,
        `    try {`,
        ...body.map((line) => `        ${line}`),
        `    } catch (thrown) {`,
        `        ${SCOPE}.stop()`,
        `        if (__rebuilt || !${lowering.use('warnMismatch')}(thrown)) throw thrown`,
        `        ${rebuild}`,
        `        return ${name}_mount(${parameters}, true)`,
        `    }`,
        `    return ${SCOPE}`,
        ...(resumes
            ? [`    } finally { ${lowering.use('leaveShare')}(__back) }`]
            : []),
        `}`,
    ].join('\n')
}

// 32.19 ON THE CLIENT — the child mounts ITSELF, against the region its markup was written into.
// The parent hands over the same accessors it handed the server emitter (33.5), so the prop is the
// caller's expression on both sides and the child re-reads it when the parent's value moves.
//
// THE CHILD'S MOUNT IS ITS OWN MODULE'S. `import Total from './Total.abide'` is the default export
// of the client module that file compiled to (`componentImports`), so the binding the author wrote
// is the function called here — the parent emits no copy of the child's bindings, and a child
// changed in place is re-emitted alone.
function emitInvocation(
    region: ComponentPlan,
    root: string,
    lowering: Lowering,
    lines: string[],
    counter: Counter,
): void {
    counter.live = true
    const props: string[] = []
    for (const attribute of region.node.attributes) {
        const value = attribute.expression
            ? lowering.expression(attribute)
            : JSON.stringify(attribute.value)
        props.push(`${JSON.stringify(attribute.name)}: () => (${value})`)
    }
    // THE CHILD'S SCOPE IS ADOPTED. Its bindings live as long as its nodes do, and what removes
    // those nodes is this region — a row that leaves, an arm that swaps — so the scope that stops
    // them has to be the one this region holds.
    lines.push(
        `${SCOPE}.adopt(${region.node.tag}(${lowering.use('regionAt')}(${step('childAt', region.parent, root, lowering, false)}, ${region.index}), { ${props.join(', ')} }))`,
    )
}

// 32.13 — one arm renders. The SERVER already rendered one, so the first run HYDRATES it rather
// than replacing it: a page that re-renders every region on load creates every node twice and
// throws away the document it was sent. The condition is evaluated once a run, the first run
// included — the arm hydrated is the arm the watch then compares against.
function emitBlock(
    region: RegionPlan,
    root: string,
    lowering: Lowering,
    lines: string[],
    helpers: string[],
    counter: Counter,
): void {
    const name = `rg${counter.next}`
    counter.next += 1
    counter.live = true
    const fillRegion = lowering.use('fillRegion')

    lines.push(
        `const ${name} = ${lowering.use('regionAt')}(${step('childAt', region.parent, root, lowering, false)}, ${region.index})`,
    )

    // Which arm takes, as one expression. `{:else}` carries no condition and is the floor.
    let take = '-1'
    for (let at = region.branches.length - 1; at >= 0; at -= 1) {
        const branch = region.branches[at] as (typeof region.branches)[number]
        take =
            branch.branch.subject === ''
                ? String(at)
                : `(${lowering.expression(branch.branch)}) ? ${at} : ${take}`
    }

    // Each arm's markup, for the swap. The server's own emitter is not reachable here, so the
    // client carries its own copy of each arm's markup — which is why `escapeText` is in #shared.
    const armHtml: string[] = []
    const armMount: string[] = []
    for (let at = 0; at < region.branches.length; at += 1) {
        const branch = region.branches[at] as (typeof region.branches)[number]
        const armLines: string[] = []
        // A NESTED REGION'S HELPERS BELONG TO THE SCOPE THAT OWNS THEM. Hoisted to `mount` they
        // read names this arm binds and nothing else does, which is a ReferenceError at the first
        // swap rather than at compile time.
        const armHelpers: string[] = []
        emitRegion(branch.plan, name, lowering, armLines, armHelpers, counter)
        armMount.push(
            `if (arm === ${at}) {`,
            ...[...armHelpers, ...armLines].map((line) => `    ${line}`),
            `}`,
        )
        armHtml.push(
            `    if (arm === ${at}) return ${emitMarkup(branch.branch.children, lowering, true)}`,
        )
    }

    helpers.push(
        mountFunction(
            name,
            `${name}, arm`,
            armMount,
            `${fillRegion}(${name}, ${name}_html(arm))`,
            lowering,
            region.branches.some((branch) => holdsComponent(branch.plan)),
        ),
    )
    helpers.push(
        `function ${name}_html(arm) {\n${armHtml.join('\n')}\n    return ''\n}`,
    )

    lines.push(`let ${name}_at`)
    lines.push(`let ${name}_scope`)
    lines.push(`${SCOPE}.watch(() => {
    const next = ${take}
    if (next === ${name}_at) return
    ${name}_at = next
    if (${name}_scope !== undefined) {
        ${name}_scope.stop()
        ${fillRegion}(${name}, ${name}_html(next))
    }
    ${name}_scope = ${name}_mount(${name}, next)
})`)
}

// 32.14 — the list. The server already rendered the rows, so the first update HYDRATES them:
// every row's element is already in the document and only its bindings are missing. Only a change
// to the list reconciles, and only the rows that moved move.
//
// 32.23 — the subject is read ONCE for the block. 32.24 — an absent subject iterates zero times.
function emitList(
    region: ListPlan,
    root: string,
    lowering: Lowering,
    lines: string[],
    helpers: string[],
    counter: Counter,
): void {
    const name = `ls${counter.next}`
    counter.next += 1
    counter.live = true

    const parent = step('childAt', region.parent, root, lowering, false)
    const block = region.block
    const subject = lowering.expression(block)
    // THE ROW BINDS ITS OWN NAME. Every emitted row function takes the author's item and index as
    // its parameters, so the body's expressions read exactly what the author wrote and nothing
    // rewrites already-emitted source — a rename by regex reaches inside static text and cannot
    // reach a nested region's helper at all.
    const item = block.item
    const at = block.index === '' ? '__at' : block.index
    // 41.9 — with no `by`, the key is the POSITION, which is 32.14's positional reconcile: a row
    // is whatever is in that slot, and a reorder rewrites the rows rather than moving them.
    // 31.12 — the item and the index SHADOW the page's names for the row, and the projection is
    // what says so: they are a `for … of` binding there, so no read in the body or the key reaches
    // the page's name of the same spelling.
    const key = block.key === '' ? at : lowering.key(block)

    const single = isSingleRooted(block.children)

    const rowLines: string[] = []
    const rowHelpers: string[] = []
    emitRegion(region.plan, '__nodes', lowering, rowLines, rowHelpers, counter)

    helpers.push(
        [
            // What the subject iterates as is `listOf`'s question, asked inside the runtime.
            `const ${name}_subject = () => ${subject}`,
            `const ${name}_key = (${item}, ${at}) => ${key}`,
            // EVERY node the body produced, not just the first. A multi-rooted row also gets its
            // anchor, so what `make` hands back matches what hydration found. Parsed in the MOUNT
            // ROOT'S document (see `parseMarkup`); `root` is `mount`'s own parameter, so it is in
            // scope from every helper whatever region owns it.
            `const ${name}_make = (${item}, ${at}) => ${lowering.use('markupNodes')}(root, ${emitRow(block.children, lowering, true)})`,
            // A row that cannot be hydrated is REBUILT from the same markup `make` uses, in place
            // and into the same array, so the reconcile still holds every node the row has.
            mountFunction(
                name,
                `__nodes, ${item}, ${at}`,
                [...rowHelpers, ...rowLines],
                `${lowering.use('replaceNodes')}(__nodes, ${name}_make(${item}, ${at}))`,
                lowering,
                holdsComponent(region.plan),
            ),
        ].join('\n'),
    )

    lines.push(
        `const ${name} = ${lowering.use('regionAt')}(${parent}, ${region.index})`,
    )
    lines.push(
        `const ${name}_list = ${lowering.use('listAt')}(${name}, ${single ? 'false' : 'true'}, ${name}_key, ${name}_make, ${name}_mount)`,
    )
    lines.push(
        `${SCOPE}.watch(() => ${lowering.use('updateList')}(${name}_list, ${name}_subject()))`,
    )
}

// ONE ADDRESSING CALL: the helper, whatever this region's base turned out to be, and the whole
// path. A NEGATIVE step is a region reference — `-1 - n` is region n directly inside what the walk
// has reached, and the step after it counts nodes past its closing anchor — and it is decoded by
// the WALK rather than here, so a reference standing in the MIDDLE of a path is the same thing as
// one standing at its head. Emitting only the head case left `[0,-1,0,0]` read as `childNodes[-1]`.
//
// An EMPTY path is the root ITSELF, which is what a nested region asks for: `regionAt(rg0, 0)` is
// region 0 of the arm, where resolving a step that is not there asked for region 0 of the arm's
// first CHILD, and no page holding one hydrated at all.
//
// `wrap` is false where the caller wants the base rather than a checked read of it — `regionAt`
// does its own checking. `blank` is passed through to `textAt`, the one helper that can be asked
// for a node the server had nothing to write.
function step(
    fn: string,
    path: number[],
    base: string,
    lowering: Lowering,
    wrap = true,
    blank = false,
): string {
    if (path.length === 0 && !wrap) return base
    return `${lowering.use(fn)}(${base}, ${JSON.stringify(path)}${blank ? ', true' : ''})`
}

// Document order. A path sorts lexicographically over its steps and a PREFIX comes first, which is
// what puts an anchor ahead of every binding under it and a blank run ahead of everything its
// missing node shifts.
function byPath(left: { path: number[] }, right: { path: number[] }): number {
    const shared = Math.min(left.path.length, right.path.length)
    for (let at = 0; at < shared; at += 1) {
        const one = left.path[at] as number
        const other = right.path[at] as number
        if (one === other) continue
        // A step AFTER a region stands later in the document than any child index in the same
        // parent — everything indexed is before the first region — and `-1 - n` is region n, so
        // the more negative of two negatives is the later one.
        if (one < 0 && other < 0) return other - one
        if (one < 0) return 1
        if (other < 0) return -1
        return one - other
    }
    return left.path.length - right.path.length
}

// Whether any expression in the run reads a name the checker called reactive. A run of static
// parts and unreactive expressions is written once by the server and never again; opening a
// binding for it is one waking reader per run on a page for nothing.
//
// ASKED OF THE READS, not of the rewrite — see `Lowering.readsIn`.
function readsReactive(run: TextRun, lowering: Lowering): boolean {
    for (const part of run.parts)
        if (part.holder !== null && lowering.readsIn(part.holder)) return true
    return false
}
