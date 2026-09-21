import type { Read } from './classifyRead.ts'
import {
    emitHead,
    emitMarkup,
    emitRow,
    importClause,
    SHARED,
    urlGuarded,
} from './emitComponent.ts'
import { hoistPaths } from './hoistPaths.ts'
import { Lowering, PROPS } from './Lowering.ts'
import type { AbideFile } from './parseAbide.ts'
import {
    type AttributeBinding,
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

// `carriesOwnMarkup` is whether this module can be mounted against an EMPTY region, which is true
// of exactly two files: one another file INVOKES as a component (32.19), mounted against a row a
// list grew by, and one a ROUTE reaches (30.11), mounted against a page no server painted. Both
// then need a second copy of the template, and one that needs neither is 34% more client than it
// needs: measured at 1797 -> 2405 shipped lines over the corpus with every file carrying one.
// WHICH FILES THOSE ARE IS THE BUILD'S KNOWLEDGE, being a fact about the import graph and the file
// tree rather than about this file, so it arrives rather than being guessed here — and it DEFAULTS
// TO NEITHER, because the wrong answer costs a static page the "ships no runtime" fact above.
export function emitClient(
    file: AbideFile,
    reads: readonly Read[] = [],
    carriesOwnMarkup = false,
): string {
    const plan = planTemplate(file.template.filter((node) => !isHead(node)))
    const lowering = new Lowering(file, reads)
    const used = lowering.used
    const lines: string[] = []
    const helpers: string[] = []
    const declarations: string[] = []
    const counter = { next: 0, live: false }
    emitRegion(plan, 'root', lowering, lines, helpers, counter, declarations)

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
    const body = carriesOwnMarkup
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
        !carriesOwnMarkup || body === "''"
            ? ''
            : `if (${lowering.use('isEmptyRegion')}(root)) ${lowering.use('fillRegion')}(root, ${body})\n`

    // 39.7 — THE HEAD A NAVIGATION HAS TO APPLY. Only a module that carries its own markup can be
    // reached without a server having rendered it, so only that module needs one; a page the
    // server painted arrives with its head already in the document.
    const headMarkup = carriesOwnMarkup ? emitHead(file, lowering, true) : "''"
    const headExport =
        headMarkup === "''"
            ? ''
            : `export function head() { return ${headMarkup} }\n`

    // NOTHING LIVE IS NO MODULE. `lines.length === 0` stopped meaning that the moment a BLANK run
    // started being addressed whether or not it reads anything reactive: a page whose only
    // expression is `{new Date().getFullYear()}` emitted a `mount` holding one `textAt` and
    // nothing else, so `bin/abide.ts` wrote a `.client.ts` beside a page that has nothing to
    // hydrate — and "this page ships no runtime" stopped being a fact about the build. A blank
    // address is only load-bearing because a LATER index counts through it, so with no binding,
    // no listener and no region anywhere in the page there is nothing for it to hold a place for.
    //
    // A FILL IS SOMETHING TO DO, which is why this asks `fills` rather than `counter.live` alone.
    // An INVOKED component with no binding in it still owns the markup for a row the browser grew
    // — the caller writes the anchor pair and nothing else (32.19) — so returning '' here shipped
    // the no-op module and left every browser-grown row of a static child empty, while the rows
    // the server painted looked right.
    if (!counter.live && fills === '' && headExport === '') return ''

    // A SCOPE IS WHAT THERE IS TO STOP, so a module with nothing live opens none. A static child
    // still ships a module — it fills the anchors of a row the browser grew — and making it
    // allocate a `Scope`, its `stops` array and an entry in the caller's `children` per row is
    // three allocations a row for a mount whose body is empty. `Scope.own(undefined)` already
    // reads a mount that returns nothing, which is the same answer the no-op module gives.
    //
    // 41.11 — THE PAGE IS THE ONE REGION THAT CANNOT REBUILD, so it is the one that has to survive
    // a refusal binding by binding. Every other region answers a mismatch by re-rendering itself
    // from its own markup (`mountFunction`); the page has no block around it and rebuilding it
    // would throw away the document the server sent, focus, scroll and all, which is exactly what
    // the clause forbids.
    //
    // ONE `try` AROUND ALL OF THEM WAS THE SAME FAILURE `Mismatch` WAS WRITTEN AGAINST: it traded
    // the throw for a warning and still skipped every binding and listener after the one that
    // refused, so a page whose first slot disagreed was served looking right and completely dead
    // below that point. Guarded per unit, what is lost is the unit that actually disagreed.
    //
    // A UNIT IS WHAT EACH EMITTER PUSHES — an anchor, an address and its binding, a listener, a
    // bound attribute, a whole block or list — and it is independent by construction: every name a
    // unit declares is read inside it, the anchors excepted, and those are declared above. The
    // wrapper is the SAME BYTES every time, which is what makes the repetition nearly free once
    // gzipped, where a `guard(() => …)` helper would be a closure allocated per binding at mount.
    const guard = (unit: string): string =>
        `try {\n${unit}\n} catch (thrown) { if (!${lowering.use('warnMismatch')}(thrown)) throw thrown }`
    const bindings = counter.live
        ? `const ${SCOPE} = new ${lowering.use('Scope')}()
${declarations.length === 0 ? '' : `let ${declarations.join(', ')}\n`}\
${lines.map(guard).join('\n')}
return ${SCOPE}`
        : ''

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
${headExport}\
export default function mount(root${lowering.takesProps() ? `, ${PROPS} = {}` : ''}) {
${opened}${setup.body}
${helpers.join('\n')}
${fills}${captured}${bindings}${closed}
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
//
// `declarations` collects the ANCHOR NAMES this region binds. They are the one name that crosses
// from one emitted unit into another — every other name a unit declares is read inside it — and a
// caller that guards its units apart (see `emitClient`) has to declare them outside those guards
// or the second unit cannot see the first one's `const`. Handed back rather than emitted here, so
// where the `let` stands is the caller's to decide.
function emitRegion(
    plan: TemplatePlan,
    root: string,
    lowering: Lowering,
    lines: string[],
    helpers: string[],
    counter: Counter,
    declarations: string[],
): void {
    const live = new Set<TextRun>()
    for (const run of plan.runs) if (readsReactive(run, lowering)) live.add(run)
    // 32.4's bindings, grouped by the element they write to. ONE grouping with two readers: the
    // anchors are counted off it and the bindings are emitted off it, and a second loop doing the
    // same filter and the same key would be byte-identical to this one — two sites a change has to
    // land on and no way to tell from a diff which of them it landed on.
    //
    // ONLY WHERE THE EXPRESSION READS A `Reactive`, which is `readsReactive`'s rule for a text run
    // asked of one attribute: `data-kind={kind}` over a plain `const` is written once by the
    // server and never moves, and a binding for it is a reader woken on every page for nothing.
    const byElement = new Map<string, AttributeBinding[]>()
    for (const bound of plan.attributes) {
        if (!lowering.readsIn(bound.attribute)) continue
        const key = bound.path.join(',')
        const group = byElement.get(key)
        if (group === undefined) byElement.set(key, [bound])
        else group.push(bound)
    }
    // A path through a REGION reference shares only what stands BEFORE the reference: a prefix
    // that ends between the two numbers a reference is written as addresses nothing, so an anchor
    // there would walk from nowhere. Cut at the first reference, the rest of the path is shared
    // like any other.
    const sharable: number[][] = []
    for (const run of live) sharable.push(beforeRegion(run.path))
    for (const handler of plan.handlers)
        sharable.push(beforeRegion(handler.path))
    // 32.4's bindings walk to an ELEMENT exactly as a listener does, so they share the same
    // anchors — and an element carrying both a listener and a bound attribute is the common case,
    // which is the shape `hoistPaths` counts rather than the one it would miss.
    //
    // ONCE PER ELEMENT, because that is how many walks there are: the bindings on one element
    // share a single `elementAt` below. Counted per ATTRIBUTE, `<a href={u} title={t}>` looked
    // like two walks under one parent and bought an anchor there that saves nothing — a name and
    // a line for a prefix only one walk ever starts from.
    // Off the group's own path rather than by parsing its key back into numbers — the key is a
    // map identity, and the array it was made from is right there.
    for (const group of byElement.values())
        sharable.push(beforeRegion((group[0] as AttributeBinding).path))
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
    // DECLARED APART FROM ITS ASSIGNMENT — see `declarations`. An anchor whose own walk refused
    // then leaves `undefined` behind, and every binding under it walks from `undefined` and
    // refuses in its own right, which is one warning per binding actually lost rather than one
    // for the whole region.
    for (const anchor of hoisted.anchors) {
        declarations.push(anchor.name)
        addresses.push({
            path: anchor.path,
            text: `${anchor.name} = ${step(
                'childAt',
                anchor.steps,
                anchor.from,
                lowering,
            )}`,
        })
    }

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

    // 32.4 — THE ATTRIBUTE BINDING. The server wrote the value standing at render; this is what
    // keeps writing it. Emitted after the runs for no reason but reading order — an attribute
    // writes into an element that already exists and shifts no index, so unlike a blank run it has
    // no place it has to take in the walk's order.
    //
    // THE ELEMENT IS RESOLVED ONCE, OUTSIDE THE WATCH, for the reason a text run's node is — the
    // node a path lands on is the same one on every run, so re-walking per write is the same
    // answer bought again.
    //
    // AND ONCE PER ELEMENT, NOT PER ATTRIBUTE. `<a href={u} title={t} class={c}>` is one element
    // and three bindings, and emitted apart each walked to it again — three `elementAt` calls and
    // three names for one node. Grouped, a refusal still loses exactly what it should: every
    // binding in the group needs the element the walk refused to find, so there is nothing left
    // for a finer guard to save.
    for (const group of byElement.values()) {
        counter.live = true
        const path = (group[0] as AttributeBinding).path
        const at = hoisted.reference(path)
        // NAMED OFF THE PATH, as the text run above is: the group IS keyed by that path, so one
        // element has one name here however many of its attributes are bound.
        const element = `__a${path.join('_').replaceAll('-', 'm')}`
        const writes: string[] = []
        for (const bound of group) {
            // 32.22 IS THE INTERPOLATION'S CLAUSE ON THIS SIDE TOO. The server scheme-checks the
            // value it writes; a binding that wrote the next one unchecked would let
            // `javascript:` into an `href` the moment the value moved, which is the one road
            // untrusted data actually takes. The same call, from the same module, so there is one
            // answer rather than two.
            const guarded = urlGuarded(
                lowering,
                bound.attribute.lowerName,
                lowering.slot(bound.attribute),
            )
            // A WATCH PER ATTRIBUTE, not one over the group: two attributes reading two different
            // values would otherwise each wake for the other's write and rewrite a string that
            // did not move. `setAttribute`'s compare would swallow the DOM cost, and the wake
            // would still be there — which is the half a correctness test cannot see.
            writes.push(
                bound.property === undefined
                    ? `${SCOPE}.watch(() => ${lowering.use('setAttribute')}(${element}, ${JSON.stringify(bound.attribute.name)}, ${guarded}))`
                    : `${SCOPE}.watch(() => ${lowering.use('setStyleProperty')}(${element}, ${JSON.stringify(bound.property)}, ${guarded}))`,
            )
        }
        lines.push(
            `const ${element} = ${step('elementAt', at.rest, at.base, lowering)}\n${writes.join('\n')}`,
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
    // THE CHILD'S SCOPE IS OWNED. Its bindings live as long as its nodes do, and what removes
    // those nodes is this region — a row that leaves, an arm that swaps — so the scope that stops
    // them has to be the one this region holds. Held rather than drained, because a child holding
    // an arm or a list of its own owns scopes that its disposer list does not reach.
    lines.push(
        `${SCOPE}.own(${region.node.tag}(${lowering.use('regionAt')}(${step('childAt', region.parent, root, lowering, false)}, ${region.index}), { ${props.join(', ')} }))`,
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

    // HELD RATHER THAN PUSHED, because a block is ONE unit: `${name}` is read by the watch below
    // and a caller that guards its units apart (`emitClient`) would put a `const` in one block and
    // its only reader in the next. Every name a unit declares is read inside it — that is what
    // makes a unit independent, and it is the property the page's per-binding guard rests on.
    const address = `const ${name} = ${lowering.use('regionAt')}(${step('childAt', region.parent, root, lowering, false)}, ${region.index})`

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
        // AND SO DO ITS ANCHORS, for the same reason and one step further: each arm is a block of
        // its own inside `${name}_mount`, so two arms may hoist an anchor of the same name and
        // neither can see the other's.
        const armDeclarations: string[] = []
        emitRegion(
            branch.plan,
            name,
            lowering,
            armLines,
            armHelpers,
            counter,
            armDeclarations,
        )
        armMount.push(
            `if (arm === ${at}) {`,
            ...(armDeclarations.length === 0
                ? []
                : [`    let ${armDeclarations.join(', ')}`]),
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

    // ONE SCOPE FOR THE BLOCK'S WHOLE LIFE, owned by the region above it and REFILLED on every
    // swap rather than replaced. A fresh scope per swap would have to be handed up per swap too,
    // and a toggle clicked a thousand times would leave a thousand of them on the region that
    // outlives it; `stop()` clears, so the same one holds only the arm currently standing.
    // `undefined` IS "NOT YET MOUNTED" and nothing else: `take` is an arm index or the `-1` floor,
    // never `undefined`, so the assignment moving below the guard is the whole of the flag.
    //
    // AND THE FIRST RUN FILLS AN EMPTY REGION RATHER THAN HYDRATING ONE. 41.4 lets a render
    // continue past a subject still in flight, and what the server writes then is the anchor pair
    // with nothing between it (see `emitComponent`'s `{#if}` arm) — so hydrating here walks for
    // nodes that were never painted. `isEmptyRegion` is the same signal an invoked component
    // already reads (32.19), asked ONCE on the first run: from the second onward `${name}_at` is
    // set and the fill happens anyway, so the region is never scanned twice for it.
    lines.push(`${address}
let ${name}_at
const ${name}_scope = ${SCOPE}.own(new ${lowering.use('Scope')}())
${SCOPE}.watch(() => {
    const next = ${take}
    if (next === ${name}_at) return
    if (${name}_at !== undefined || ${lowering.use('isEmptyRegion')}(${name})) {
        ${name}_scope.stop()
        ${fillRegion}(${name}, ${name}_html(next))
    }
    ${name}_at = next
    ${name}_scope.own(${name}_mount(${name}, next))
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
    const rowDeclarations: string[] = []
    emitRegion(
        region.plan,
        '__nodes',
        lowering,
        rowLines,
        rowHelpers,
        counter,
        rowDeclarations,
    )

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
                // The row's anchors, declared where the page declares its own. INSIDE the mount's
                // one `try` rather than above it, because a row rebuilds whole: an anchor that
                // refused is the row disagreeing, and re-rendering it from its own markup is the
                // answer the page does not have.
                [
                    ...(rowDeclarations.length === 0
                        ? []
                        : [`let ${rowDeclarations.join(', ')}`]),
                    ...rowHelpers,
                    ...rowLines,
                ],
                `${lowering.use('replaceNodes')}(__nodes, ${name}_make(${item}, ${at}))`,
                lowering,
                holdsComponent(region.plan),
            ),
        ].join('\n'),
    )

    // ONE UNIT, for `emitBlock`'s reason: the list's region and the `List` built over it are both
    // read by the watch, so the three lines cannot be guarded apart.
    // OWNED BY THE REGION ABOVE IT: `dropRow` stops a row as the list churns, but a block removed
    // whole drops no rows, so `List.stop` is what reaches the ones still standing.
    lines.push(
        `const ${name} = ${lowering.use('regionAt')}(${parent}, ${region.index})
const ${name}_list = ${SCOPE}.own(${lowering.use('listAt')}(${name}, ${single ? 'false' : 'true'}, ${name}_key, ${name}_make, ${name}_mount))
${SCOPE}.watch(() => ${lowering.use('updateList')}(${name}_list, ${name}_subject()))`,
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
