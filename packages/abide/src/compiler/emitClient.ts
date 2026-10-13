import {
    RAW_CLOSE,
    RAW_OPEN,
    REGION_CLOSE,
    REGION_OPEN,
    ROW_OPEN,
} from '#shared/ANCHORS.ts'
import { anchorMarkup } from '#shared/anchorMarkup.ts'
import { CHILDREN } from '#shared/CHILDREN.ts'
import { type CheckerAnswer, UNCHECKED } from './CheckerAnswer.ts'
import {
    Cursor,
    type PlacedNode,
    placeTemplate,
    REGION_ROOT,
    ROW_ROOT,
} from './Cursor.ts'
import {
    type ClassifiedAttribute,
    classifyAttributes,
    isBound,
    isSingleRooted,
    isSlot,
} from './classifyTemplate.ts'
import { decodeCharacterReferences } from './decodeCharacterReferences.ts'
import { moduleImports } from './emitComponent.ts'
import { invocationProps, passedName } from './invocationProps.ts'
import { isNamedAlone } from './isNamedAlone.ts'
import { type LoweredChunk, Lowering, PROPS } from './Lowering.ts'
import type { AbideFile } from './parseAbide.ts'
import {
    CLIENT_LANE,
    chosenArm,
    headSink,
    mergedValue,
    renderMarkup,
    rowMarkup,
    unlandable,
    type ValueRender,
} from './renderMarkup.ts'
import { SHARED_NAMES } from './SHARED_NAMES.ts'
import { RUNTIME_SPECIFIER, SHARED_SPECIFIER } from '#shared/SPECIFIERS.ts'
import {
    insideShare,
    resumedShare,
    SETTLED_AT,
    shareScope,
} from './shareScope.ts'
import { splitImports } from './splitImports.ts'
import type {
    Attribute,
    ElementNode,
    ForBlock,
    InlineComponent,
    Setup,
    TemplateNode,
} from './TemplateNode.ts'

// The client half of one `.abide`. WHERE A NODE STANDS IS DECIDED ONCE, by `placeTemplate`, and the
// server's markup is rendered from the same positions this module walks, builds and fills from. So
// the position the server wrote to and the position this module walks to are one answer, rather
// than two walks held in agreement by the predicates they share.
//
// NOTHING IS ADDED TO THE DOCUMENT to make this work. Each node is found from the one before it or
// the one it stands in, which is exact for a region whose shape is static — and a compiled
// template's is, up to the boundaries where 32.12, 32.13 and 32.15 make it depend on a value.
// Those boundaries are where a marker earns its place, and the walk steps over each from its
// closing anchor; nowhere before them does a marker earn anything.
//
// 41.6 — hydration re-executes the setup, so the values the client starts from are the values the
// document was rendered with.

/**
 * One region's emission: the lines it pushes, and the module it is emitted into.
 *
 * THE ACCUMULATORS ARE THE REGION'S AND THE NAMING IS THE MODULE'S. `chain`, `helpers` and `lines`
 * belong to the one region being emitted — the page, an arm, a row, a slot's fallback, a caller's
 * children — while the counter that names a nested region is shared by every region of the module,
 * so two regions never claim one name.
 */
class RegionEmission {
    /** 32.43 — the region's inline components, declared ahead of everything that invokes them. */
    defs: string[] = []
    /** The walk: one `const` per position it needs, each found from the one before it. */
    readonly chain: string[] = []
    readonly helpers: string[] = []
    /** The units, each guarded apart on a page (`guard`). */
    readonly lines: string[] = []
    readonly lowering: Lowering
    private readonly counter: { next: number }

    constructor(lowering: Lowering, counter = { next: 0 }) {
        this.lowering = lowering
        this.counter = counter
    }

    /** The next region's name under `prefix`, unique in the module. */
    claim(prefix: string): string {
        const name = `${prefix}${this.counter.next}`
        this.counter.next += 1
        return name
    }

    /** A region nested in this one, named from the same module. */
    nested(): RegionEmission {
        return new RegionEmission(this.lowering, this.counter)
    }

    /** A nested region's body, in the order the emitted function needs it: walk, helpers, units. */
    body(): string[] {
        return [...this.defs, ...this.chain, ...this.helpers, ...this.lines]
    }
}

/**
 * Which empty regions a client module fills itself: a routed page's, an invoked row's, or both.
 *
 * A file a ROUTE reaches (30.11) is mounted against a page no server painted, once a
 * navigation; a file another INVOKES
 * as a component (32.17) can stand in a row a list grew by, once A ROW. Both need a second copy of
 * the template, and one that needs neither is 34% more client than it needs: measured at 1797 ->
 * 2405 shipped lines over the corpus with every file carrying one. INVOKED decides whether that
 * copy is markup or a build (`Cursor.repeated`) — a page's fill is one parse, and a component's is
 * a parse per row — and ROUTED decides whether it carries a head (39.6). A file can be both, and
 * then each fact decides its own half.
 *
 * WHICH FILES THOSE ARE IS THE BUILD'S KNOWLEDGE, being a fact about the import graph and the file
 * tree rather than about this file, so it arrives rather than being guessed here — and it DEFAULTS
 * TO NEITHER, because the wrong answer costs a static page the "ships no runtime" fact
 * (`compileApp`).
 */
export type SelfFill = 'none' | 'routed' | 'invoked' | 'both'

// The mount's third argument, which only the router passes (`Router.mountFrom`).
const ROUTED = '__routed'

/**
 * The client module for one `.abide`: its mount, and its own fill where `selfFill` asks.
 *
 * `''` where there is nothing to hydrate and nothing imports it by name.
 */
export function emitClient(
    file: AbideFile,
    answer: CheckerAnswer = UNCHECKED,
    selfFill: SelfFill = 'none',
    /** 38.97 — where given, every chunk the module is written around (`sourceMapOf`). */
    chunks?: LoweredChunk[],
): string {
    const carriesOwnMarkup = selfFill !== 'none'
    const lowering = new Lowering(file, answer, false, chunks)
    // THE TEMPLATE IS PLACED ONCE (`placeTemplate`) and everything this module emits is rendered
    // from what was placed: the mount's walk, a region's build, and the markup a region made once
    // fills from — the same positions the server's markup is rendered from.
    const page = new Cursor(
        undefined,
        undefined,
        false,
        selfFill === 'invoked' || selfFill === 'both',
    )
    page.components = file.components
    placeTemplate(file.template, page)
    const { defs, chain, helpers, lines } = emitRegion(
        page,
        new RegionEmission(lowering),
    )
    // 35.17 — THE DOCUMENT'S OWN `<html>` AND `<body>`, bound as any element is: the server wrote
    // the values standing at render, and these keep writing them. Nothing to find, so no walk.
    if (file.document !== undefined)
        for (const [element, node, slot] of [
            ['document.documentElement', file.document.html, 'html'],
            ['document.body', file.document.body, 'body'],
        ] as const) {
            const classified = classifyAttributes(node, lowering)
            if (!classified.some(isBound)) continue
            const units = elementUnits(element, classified, slot, lowering)
            for (const unit of units.handlers) lines.push(unit)
            for (const unit of units.attributes) lines.push(unit)
            for (const unit of units.elements) lines.push(unit)
        }

    // 34.2 — A `<script module>` IS PROCESS-WIDE IN A BROWSER, which is MODULE SCOPE: it is
    // evaluated once when this module is first imported rather than once per `mount`, so a second
    // mount of the same page reads what the first one left.
    const moduleSetup = splitImports(lowering.modules())
    // 32.17 — A COMPONENT FILLS ITS OWN REGION where the server wrote none. A row the list grew by
    // is built in the browser, and the child's markup is in the child's SERVER module — which the
    // browser may not reach. So the caller writes the anchor pair alone and the child fills it
    // from the template this module already holds, once, inside the instance whose setup just ran.
    // Rendering it from the caller instead would mean the child's setup running twice per row: one
    // run for the markup and another for the bindings.
    //
    // 39.6 — A ROUTE LEVEL APPLIES ITS OWN HEAD THERE, for the same reason: an empty region is
    // one no server painted, so no server wrote this level's head either. Inside `mount`, after
    // the setup, because a `<title>{title}</title>` reads the instance's names as a body slot does
    // — at module scope it was a ReferenceError on every navigation to it. Before the fill, so the
    // title the reader sees is the page they are arriving at for however long the build takes;
    // and a layout mounts before the page in its slot, so the deepest contribution lands last and
    // wins (39.4). A region the server painted is hydrated with the head the server wrote.
    //
    // ONLY WHERE THE ROUTER MOUNTED IT, which it says with `ROUTED`: the server writes the heads of
    // the route's chain alone, and an invoked component fills an empty region once per row the list
    // grew by — applying a head there is a parse and a walk of `document.head` a row. So a file that
    // is both routed and invoked titles the document as a page and leaves it alone as a row.
    const routed = selfFill === 'routed' || selfFill === 'both'
    const head = routed ? headSink(file) : undefined
    const headMarkup =
        head === undefined ? "''" : renderMarkup(head, lowering, CLIENT_LANE)
    const heads = headMarkup !== "''"
    // 39.13 — A HEAD THAT READS SOMETHING LIVE FOLLOWS IT, from a watch the page's scope owns — live
    // by the rule `emitRegion` binds by. One that reads nothing that moves is applied once.
    const liveHeads = head !== undefined && heads && readsLive(head, lowering)
    // 39.14 — THE HEAD IS LEFT ON THE LEVEL the router handed in, painted or not, for the router
    // to read when this level leaves or a level under it does. One thunk, which the apply below
    // reads too, so the markup expression is emitted once.
    const registered = heads
        ? `if (${ROUTED}) ${ROUTED}.head = () => ${headMarkup}\n`
        : ''
    const applied = heads
        ? `if (${ROUTED}) ${lowering.use('applyHead')}(${ROUTED}.head()); `
        : ''
    // Applied with the fill either way, so the watch's first run only subscribes: what it would
    // write is already there, from the server or from the line above.
    if (liveHeads)
        lines.push(
            `if (${ROUTED}) ${lowering.use('liveHead')}(${SCOPE}, ${ROUTED}.head)`,
        )
    // 39.1, 39.6 — A COMPONENT'S HEAD IS ITS PAGE'S, on a navigation as on the server: added to the
    // level the router is mounting (`contributeHead`), which a row grown later is not.
    const ownHead = routed ? undefined : headSink(file)
    const ownMarkup =
        ownHead === undefined
            ? "''"
            : renderMarkup(ownHead, lowering, CLIENT_LANE)
    const contributed =
        ownMarkup === "''"
            ? ''
            : `${lowering.use('contributeHead')}(${REGION_ROOT}, () => ${ownMarkup})\n`
    const builds = carriesOwnMarkup && page.positions.length > 0
    let fills = contributed
    if (applied !== '' || builds) {
        const build = builds
            ? `function __build(__document) {\n    ${emitMaker(page, lowering)}\n}\n`
            : ''
        // THE HEAD GOES BEFORE THE FILL, so the guard is written out where there is one to apply.
        fills +=
            applied === ''
                ? `${registered}${build}${lowering.use('fillEmpty')}(${REGION_ROOT}, __build)\n`
                : `${registered}${build}if (${lowering.use('isEmptyRegion')}(${REGION_ROOT})) { ${applied}${builds ? `${lowering.use('fillRegion')}(${REGION_ROOT}, __build)` : ''} }\n`
    }

    // NOTHING LIVE IS NO MODULE: every unit the page's region pushes is a binding, a listener or a
    // region, so an empty `lines` is a page with nothing live anywhere in it.
    // A blank run is only walked because something AFTER it is found through it, so with no
    // binding, no listener and no region anywhere in the page there is nothing to walk to.
    //
    // A FILL IS SOMETHING TO DO, which is why this asks `fills` rather than `lines` alone.
    // An INVOKED component with no binding in it still owns the markup for a row the browser grew
    // — the caller writes the anchor pair and nothing else (32.17) — so without its module every
    // browser-grown row of a static child would be empty.
    //
    // A FILE MOUNTED AGAINST AN EMPTY REGION SHIPS A MODULE REGARDLESS: the router or the caller's
    // client module imports it by name, so the no-op is what it ships.
    //
    // 41.6 — BUT A `<script>` IS SOMETHING TO DO: hydration reruns every setup, and a static
    // component's can still open a watch, write a shared value or listen on the window.
    const live = lines.length > 0
    const setup = splitImports(lowering.scripts())
    if (!live && fills === '' && setup.body === '') {
        const mount = carriesOwnMarkup ? 'export default () => {}\n' : ''
        // 34.2 — A `<script module>` RUNS IN THE BROWSER TOO, live markup or none: its module scope
        // is the browser's as much as the server's.
        if (moduleSetup.body === '' && moduleSetup.imports === '') return mount
        return `${moduleImports(lowering, (name) => (SHARED_NAMES.has(name) ? SHARED_SPECIFIER : RUNTIME_SPECIFIER), [moduleSetup])}
${moduleSetup.body}
${mount}`
    }

    // A SCOPE IS WHAT THERE IS TO STOP, so a module with nothing live opens none. A static child
    // still ships a module — it fills the anchors of a row the browser grew — and making it
    // allocate a `Scope`, its `stops` array and an entry in the caller's `children` per row is
    // three allocations a row for a mount whose body is empty. `Scope.own(undefined)` already
    // reads a mount that returns nothing, which is the same answer the no-op module gives.
    //
    // 41.10 — THE PAGE IS THE ONE REGION THAT CANNOT REBUILD, so it is the one that has to survive
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

    // THE WALK STANDS OUTSIDE EVERY GUARD, which is why it cannot throw (see `emitRegion`): it runs
    // once, top to bottom, after `fills` has put the page in place, and each unit then checks the
    // one node it was handed.
    const owning = scopedSetup(setup.body, lowering)
    const bindings = scopeBindings(owning, chain, lines, lowering)

    // 10.5 on the other side, and the same scope: the child's `mount` is called from inside the
    // parent's, so the chain a key is looked up is the component tree here too.
    // 10.5 — CAPTURED WHERE A DEFERRED MOUNT CAN NEED IT. A row or an arm mounted after the fact
    // runs from a `watch` effect, with nothing on the stack; this is the scope it resumes.
    const captured = page.defersSetup
        ? `const ${SHARE_AT} = ${lowering.use('currentShare')}()\n`
        : ''
    const { opened, closed } = shareScope(lowering, '')
    // Ahead of the imports, which are read off what the lowering was asked for.
    const levelMarkup = `${[...defs, ...helpers].join('\n')}\n${fills}${captured}${bindings}`
    const markup = routed
        ? deferredMarkup(levelMarkup, owning.declared, lowering)
        : levelMarkup
    // The escaping is an APP's (`@abide/abide`); everything else is the client runtime's (`@abide/abide/runtime`).
    // THE SETUP IS NOT RE-INDENTED. Adding a margin to every line rewrites the INSIDE of a
    // multi-line template literal, so a string constant gains four spaces it never had.
    return `${moduleImports(lowering, (name) => (SHARED_NAMES.has(name) ? SHARED_SPECIFIER : RUNTIME_SPECIFIER), [moduleSetup, setup])}
${moduleSetup.body === '' ? '' : `${moduleSetup.body}\n`}\
export default function mount(${REGION_ROOT}${routed ? `, ${PROPS} = {}, ${ROUTED}` : lowering.takesProps() ? `, ${PROPS} = {}` : ''}) {
${opened}${owning.opened}${setup.body}
${owning.handed}${markup}${owning.closed}${closed}
}
`
}

/**
 * 12.4, 12.13 — THE SCOPE IS MADE BEFORE THE SETUP, so the watches the setup opens land in it as
 * they open (`collectWatches`) and a watch has one owner from the start. The collection stops before
 * the markup: a binding is its scope's by `Scope.watch`, and a child mounted there collects its own.
 *
 * `declared` says the scope exists — a body with no setup leaves it to `scopeBindings`, which makes
 * none where nothing is live.
 */
function scopedSetup(
    body: string,
    lowering: Lowering,
    /**
     * 10.5 — a branch-local setup, which a later swap or a grown row runs from a `watch` effect with
     * no share scope current, so it resumes its instance's (`SHARE_AT`).
     */
    resumes = false,
): { opened: string; handed: string; closed: string; declared: boolean } {
    if (body === '')
        return { opened: '', handed: '', closed: '', declared: false }
    const collect = lowering.use('collectWatches')
    const share = resumes ? resumedShare(lowering, SHARE_AT) : undefined
    const resume = share ? `${share.resume}\n` : ''
    const leave = share ? `; ${share.leave}` : ''
    return {
        opened: `${resume}const ${SCOPE} = new ${lowering.use('Scope')}()\nconst __owner = ${collect}(${SCOPE}.stops)\ntry {\n`,
        handed: `${collect}(undefined)\n`,
        // A SETUP THAT THROWS answers no scope for anything to hold, so it is stopped here — under
        // a `{#try}` every retry would otherwise leave one more watch running.
        closed: `\n} catch (thrown) {\n${SCOPE}.stop()\nthrow thrown\n} finally { ${collect}(__owner)${leave} }`,
        declared: true,
    }
}

/**
 * A component's bindings over the scope its setup made, or a scope of their own where it made none.
 *
 * A BODY WITH NOTHING LIVE ANSWERS NO SCOPE — `Scope.own(undefined)` reads it as static — unless its
 * setup opened something, and then that is what there is to stop.
 */
function scopeBindings(
    owning: { declared: boolean },
    chain: string[],
    lines: string[],
    lowering: Lowering,
): string {
    if (lines.length === 0)
        return owning.declared
            ? `return ${SCOPE}.stops.length === 0 ? undefined : ${SCOPE}`
            : ''
    return `${owning.declared ? '' : `const ${SCOPE} = new ${lowering.use('Scope')}()\n`}\
${chain.map((line) => `${line}\n`).join('')}\
${lines.map((unit) => guard(unit, lowering)).join('\n')}
return ${SCOPE}`
}

/**
 * A routed level's markup, handed to the router to run once every level is set up.
 *
 * 41.19 ON THE CLIENT — EVERY LEVEL IS SET UP BEFORE ANY IS HYDRATED, as `composePage` sets every
 * level up before it builds any. A page's setup can write what its layout's markup reads, and the
 * server painted the layout after that write: hydrating the layout first, inside its own mount,
 * read the value before the page had written it and disagreed with the document. So a level the
 * router mounts leaves its markup on the level it was handed, which the router runs once the whole
 * chain is set up; anything else that mounts the file runs it at once. The share scope the setup
 * ran in is resumed for it (10.5), as `emitComponent`'s deferred build resumes one — and left on
 * the level too, for the router to set the level below up inside it.
 */
function deferredMarkup(
    markup: string,
    /** The setup made the scope, so the level holds it before its markup runs — or if it never does. */
    declared: boolean,
    lowering: Lowering,
): string {
    return `const ${SETTLED_AT} = ${lowering.use('currentShare')}()
function __markup(${REGION_ROOT}) {
${insideShare(lowering, SETTLED_AT, markup)}
}
if (${ROUTED}) { ${ROUTED}.markup = __markup; ${ROUTED}.share = ${SETTLED_AT}; return${declared ? ` ${SCOPE}` : ''} }
return __markup(${REGION_ROOT})`
}

/**
 * One unit of a component's mount, guarded apart from the others.
 *
 * The wrapper is the SAME BYTES every time, which is what makes the repetition nearly free once
 * gzipped, where a `guard(() => …)` helper would be a closure allocated per binding at mount.
 */
function guard(unit: string, lowering: Lowering): string {
    return `try {\n${unit}\n} catch (thrown) { if (!${lowering.use('warnMismatch')}(thrown)) throw thrown }`
}

/**
 * An inline component on the client: the mount a file component's module exports, declared in
 * place.
 *
 * 32.17, 32.40 — INVOKED AS A FILE COMPONENT IS, against its region and with the record of
 * accessors its pattern binds from, and it FILLS ITS OWN REGION where no server painted one — an
 * invoked file's `SelfFill`, which every inline component is, and built rather than parsed since
 * it can stand in a row (`Cursor.repeated`). Its units are guarded apart as a file's are.
 *
 * 32.42 — DECLARED WHERE ITS REGION MOUNTS, so it closes over every name in scope there.
 */
function clientComponent(
    component: InlineComponent,
    parent: RegionEmission,
): string {
    const lowering = parent.lowering
    const sink = new Cursor(undefined, undefined, false, true)
    sink.components = component.components
    placeTemplate(component.children, sink)
    const { defs, chain, helpers, lines } = emitRegion(sink, parent.nested())
    const head =
        component.pattern === '' ? '' : `${lowering.setup(component)}\n`
    const setup =
        component.setup === null ? '' : `${lowering.setup(component.setup)}\n`
    const owning = scopedSetup(setup, lowering)
    const fill =
        sink.positions.length === 0
            ? ''
            : `function __build(__document) {\n    ${emitMaker(sink, lowering)}\n}
${lowering.use('fillEmpty')}(${REGION_ROOT}, __build)\n`
    const captured = sink.defersSetup
        ? `const ${SHARE_AT} = ${lowering.use('currentShare')}()\n`
        : ''
    const bindings = scopeBindings(owning, chain, lines, lowering)
    // 10.5, 32.46 — its own share scope per instance, as on the server (`serverComponent`).
    const { opened, closed } = shareScope(lowering, '')
    return `function ${component.name}(${REGION_ROOT}, ${PROPS} = {}) {
${opened}${head}${owning.opened}${setup}${owning.handed}${[...defs, ...helpers].join('\n')}
${fill}${captured}${bindings}${owning.closed}${closed}
}`
}

/**
 * The statements declaring a region's inline components on the client: the ones its body declares
 * (32.43), each under its name, and the ones an invocation in it is passed (32.50), each under
 * `passedName`.
 *
 * DECLARED IN THE REGION EVEN WHERE NOTHING IN IT IS READ, a row's included: one function a row
 * mount, which `inlineRowShare.ts` prices inside the noise of the mount around it. Hoisting the
 * ones that read nothing of the row would be a scope analysis and a branch with no ratio to earn it.
 */
function definitions(sink: Cursor, region: RegionEmission): string[] {
    const out: string[] = []
    for (const component of sink.components)
        out.push(clientComponent(component, region))
    for (const at of sink.positions)
        if (at.kind === 'region' && at.holder.kind === 'element')
            for (const passed of at.holder.passed)
                out.push(
                    `const ${passedName(passed)} = ${clientComponent(passed, region)}`,
                )
    return out
}

/**
 * Whether a placed region reads anything that moves.
 *
 * 39.13 — by `emitRegion`'s own rule: a nested region, a live text run, or an attribute
 * `lowering.isLive` says is.
 */
function readsLive(sink: Cursor, lowering: Lowering): boolean {
    for (const at of sink.positions) {
        if (at.kind === 'region') return true
        if (at.kind === 'text') {
            if (lowering.isLiveRun(at.run)) return true
            continue
        }
        for (const one of classifyAttributes(
            at.holder as ElementNode,
            lowering,
        ))
            if (one.live) return true
    }
    return false
}

/**
 * One region's bindings, as its walk, its helpers and its guarded units.
 *
 * Emitted against the region's own root: the page, a `{#if}` arm, a `{#for}` row, a `<slot/>`
 * fallback or a caller's children. Each is a sink of its own (`Cursor`), so `__c1` in one and
 * `__c1` in another are different nodes and neither region can reach the other's.
 *
 * TWO KINDS OF LINE, and the split is 41.10's. The WALK — one `const` per position it needs, each
 * found from the one before it — goes into `chain` and NEVER THROWS: an absent node is carried
 * forward as `undefined`. The UNITS go into `lines`, and each CHECKS the node it was handed
 * (`elementHere`, `textHere`, `regionFound`). On a page, where every unit is guarded apart, a node
 * that disagrees then loses the unit that needed it and nothing after it — the locality a path
 * re-walked from the root used to buy, without re-walking.
 *
 * THE WALK IS PRUNED. A position is walked when something at or after it in its parent needs it —
 * a binding, or a later position found through it — so a static subtree and a static tail are
 * never visited. A blank run standing before something walked is put back as the walk passes
 * (`runHere`), because what follows it is found from it.
 */
function emitRegion(sink: Cursor, region: RegionEmission): RegionEmission {
    const lowering = region.lowering
    const chain = region.chain
    const lines = region.lines
    const positions = sink.positions
    // Each bound element's attributes, classified once and read by both passes below.
    const bound = new Map<PlacedNode, ClassifiedAttribute[]>()
    const live = new Set<PlacedNode>()
    for (const at of positions) {
        if (at.kind === 'region') {
            live.add(at)
            continue
        }
        if (at.kind === 'text') {
            if (lowering.isLiveRun(at.run)) live.add(at)
            continue
        }
        const classified = classifyAttributes(
            at.holder as ElementNode,
            lowering,
        )
        if (!classified.some(isBound)) continue
        bound.set(at, classified)
        live.add(at)
    }

    // BACKWARDS, so everything after a position — its later siblings and its own descendants — is
    // decided before it is. `followed` holds the frames, keyed by the element they stand inside,
    // that have a walked position later than the one being decided.
    const walked = new Set<PlacedNode>()
    const followed = new Set<PlacedNode | null>()
    for (let index = positions.length - 1; index >= 0; index -= 1) {
        const at = positions[index] as PlacedNode
        if (!live.has(at) && !followed.has(at) && !followed.has(at.within))
            continue
        walked.add(at)
        followed.add(at.within)
    }

    for (const at of positions) {
        if (!walked.has(at)) continue
        if (at.kind === 'region')
            chain.push(
                `const ${at.name} = ${lowering.use('regionHere')}(${at.from})`,
            )
        // A RUN THAT CAN HOLD MARKUP (32.26) is stepped over to its closing anchor where it does,
        // and a blank one is put back where it rendered nothing — the same step (`runHere`). A run
        // of proven parts is text for good and is its node as found.
        else if (
            at.kind === 'text' &&
            (at.blank || lowering.holdsMarkup(at.run))
        )
            chain.push(
                `const ${at.name} = ${lowering.use('runHere')}(${at.from}, ${at.blank ? at.parent : 'null'})`,
            )
        else chain.push(`const ${at.name} = ${at.from}`)
    }

    // THE UNITS, in the order a page always installed them — text, listeners, attributes, the node
    // handed over, then the regions. The walk does not depend on it; a `bind:element` callback has
    // always run with every other binding already in place, and that is kept.
    const texts: string[] = []
    const handlers: string[] = []
    const attributes: string[] = []
    const elements: string[] = []
    const regions: PlacedNode[] = []
    for (const at of positions) {
        if (!live.has(at)) continue
        if (at.kind === 'region') {
            regions.push(at)
            continue
        }
        const slot = at.name.slice('__c'.length)
        if (at.kind === 'text') {
            const values: string[] = []
            const brands: string[] = []
            const text: string[] = []
            const markup: string[] = []
            for (let piece = 0; piece < at.run.length; piece += 1) {
                const node = at.run[piece] as TemplateNode
                if (node.kind === 'text') {
                    markup.push(JSON.stringify(node.text))
                    // 32.27 — static text is markup, and `data` is not a parse: a piece with an
                    // entity in it goes in as the characters it stands for, decoded by the build.
                    text.push(
                        JSON.stringify(
                            decodeCharacterReferences(node.text, 'text'),
                        ),
                    )
                    continue
                }
                const value = `__v${slot}_${piece}`
                values.push(`${value} = ${lowering.expression(node)}`)
                brands.push(`${lowering.use('isRaw')}(${value})`)
                text.push(`${lowering.use('escapeless')}(${value})`)
                markup.push(`${lowering.use('escapeText')}(${value})`)
            }
            // RESOLVED ONCE, and the binding closes over what it resolved to. The node a position
            // lands on is the same one on every run while the run holds text — the walk put a blank
            // run's back and `setText` never removes it — so re-finding it per write is the same
            // answer bought again: measured in Chromium at 0.47 µs a write against 0.22 µs with the
            // node held. 32.26 is the one write that changes it: a `Raw` part turns the run into an
            // anchored one (`setMarkup`) and a later text value turns it back, so each write hands
            // back what the run now is and the binding holds that.
            texts.push(
                `let __t${slot} = ${lowering.use('textHere')}(${at.name})
${SCOPE}.watch(() => {
    const ${values.join(', ')}
    __t${slot} = ${brands.join(' || ')} ? ${lowering.use('setMarkup')}(__t${slot}, ${markup.join(' + ')}) : ${lowering.use('setText')}(__t${slot}, ${text.join(' + ')})
})`,
            )
            continue
        }
        const units = elementUnits(
            `${lowering.use('elementHere')}(${at.name}, ${JSON.stringify(at.tag)})`,
            bound.get(at) as ClassifiedAttribute[],
            slot,
            lowering,
        )
        for (const unit of units.handlers) handlers.push(unit)
        for (const unit of units.attributes) attributes.push(unit)
        for (const unit of units.elements) elements.push(unit)
    }
    for (const unit of texts) lines.push(unit)
    for (const unit of handlers) lines.push(unit)
    for (const unit of attributes) lines.push(unit)
    for (const unit of elements) lines.push(unit)

    for (const at of regions) {
        const holder = at.holder
        if (holder.kind === 'block') {
            if (holder.block === 'for') emitList(at, holder, region)
            else if (holder.block === 'try') emitTry(at, holder, region)
            else emitBlock(at, holder, region)
        } else if (holder.kind === 'element') {
            if (isSlot(holder)) emitSlot(at, region)
            else emitInvocation(at, holder, region)
        }
    }
    // 32.43 — A REGION THAT MOUNTS NOTHING INVOKES NOTHING, so what it declares is reached from
    // nowhere and is not declared: a row declaring a component it never invokes stays a row whose
    // mount is the shared empty one.
    if (lines.length > 0) region.defs = definitions(sink, region)
    return region
}

/**
 * One bound element's units — its listeners, its attribute bindings and the node it hands over —
 * against the element `element` evaluates to.
 *
 * 32.3 — THE ATTRIBUTE BINDING. The server wrote the value standing at render; this is what keeps
 * writing it. ONCE PER ELEMENT, NOT PER ATTRIBUTE: `<a href={u} title={t}>` is one element and two
 * bindings, and a refusal loses exactly what it should either way, because every binding in the
 * group needs the element the check refused. The document's own `<html>` and `<body>` are bound
 * through here too (35.17), an element being whatever `element` reaches.
 */
function elementUnits(
    element: string,
    classified: ClassifiedAttribute[],
    slot: string,
    lowering: Lowering,
): { handlers: string[]; attributes: string[]; elements: string[] } {
    const handlers: string[] = []
    const attributes: string[] = []
    const elements: string[] = []
    const writes: string[] = []
    const binds: string[] = []
    const spreads: string[] = []
    for (const one of classified) {
        if (!isBound(one)) continue
        if (one.kind === 'handler')
            handlers.push(
                `${element}.addEventListener(${JSON.stringify(one.event)}, ${lowering.expression(one.attribute)})`,
            )
        // 32.5, 32.7, 32.8 — THE PROPERTY AND THE VALUE, IN STEP BOTH WAYS: a watch on this
        // region's scope writes the property, and a listener writes it back.
        else if (one.kind === 'bound')
            binds.push(
                `${lowering.use('bindProperty')}(${element}, ${JSON.stringify(one.bind)}, ${lowering.reference(one.attribute)}, ${SCOPE})`,
            )
        // 32.11 — THE SPREAD, KEPT WRITTEN: an attribute it stops carrying is removed.
        else if (one.kind === 'spread')
            spreads.push(
                `${lowering.use('bindSpread')}(${element}, () => (${lowering.expression(one.attribute)}), ${JSON.stringify(one.explicit)}, ${SCOPE})`,
            )
        // 32.9 — THE NODE, HANDED OVER, once. Not a watch: what the value takes is the element,
        // which is the same node on every run a watch would have made — and the callback
        // form's `Disposer` goes on this region's scope, so a widget it set up is torn down
        // when the nodes it was set up over leave.
        else if (one.kind === 'element')
            elements.push(
                `const __r${slot} = ${lowering.use('bindElement')}(${element}, ${lowering.reference(one.attribute)})
if (__r${slot} !== undefined) ${SCOPE}.stops.push(__r${slot})`,
            )
        // 32.20 IS THE INTERPOLATION'S CLAUSE ON THIS SIDE TOO, and 32.37's absence with it:
        // `setAttribute` answers through `attributeText`, as the server's markup did, so a
        // `javascript:` the server refused is refused the moment the value moves too.
        // A WATCH PER ATTRIBUTE, not one over the group: two attributes reading two
        // different values would otherwise each wake for the other's write.
        else {
            const { write, name } =
                one.kind === 'merged' && one.toggles !== undefined
                    ? one.toggles
                    : {
                          write: 'attribute' as const,
                          name: one.attribute.name,
                      }
            writes.push(
                `${SCOPE}.watch(() => ${lowering.use(WRITES[write])}(__a${slot}, ${JSON.stringify(name)}, ${lowering.expression(one.attribute)}))`,
            )
        }
    }
    if (writes.length > 0)
        attributes.push(
            `const __a${slot} = ${element}\n${writes.join('\n')}`,
        )
    for (const unit of binds) attributes.push(unit)
    for (const unit of spreads) attributes.push(unit)
    return { handlers, attributes, elements }
}

// A region's bindings go through its SCOPE, so what replaced the region can stop them (see
// `Scope`). In the framework's own `__` namespace because a row binds the AUTHOR's item name as a
// parameter in the same scope.
const SCOPE = '__scope'

// Which runtime write each kind of attribute binding is handed to. A record rather than a chain
// of ternaries, so a fourth kind is a row here and the call site stays one line — all three take
// the same three arguments, which is what makes them one site at all.
const WRITES = {
    attribute: 'setAttribute',
    class: 'setClass',
    style: 'setStyleProperty',
} as const

// The share scope an instance captures for its deferred mounts (10.5), named apart from the one an
// instance OPENS (`shareScope`): a page that shares nothing still carries this for a child that does.
const SHARE_AT = '__shareAt'

// The document a region's maker is handed and builds its nodes from.
const DOCUMENT = '__document'

// A run's anchors while it holds markup (32.30), as the JS string literals a built run parses with.
const RAW_OPEN_MARKUP = JSON.stringify(anchorMarkup(RAW_OPEN))
const RAW_CLOSE_MARKUP = JSON.stringify(anchorMarkup(RAW_CLOSE))

/**
 * The body of the function that makes a region's nodes from a `__document`.
 *
 * WHAT MAKES A REGION'S NODES, as the body of a function taking the region's `__document`: the
 * row, the arm, the slot's fallback, the caller's children and the page that fills itself are all
 * made the same way. BUILT from the positions the markup walk placed (`emitBuild`) — or, where the
 * region holds content only the parser makes right (`isParserOwned`), PARSED from the very markup
 * the server writes, which is the one representation that cannot disagree with it.
 *
 * THE MARKUP IS ASKED FOR ONLY WHERE IT IS USED, as a thunk: writing it binds the markup writer's
 * names (`escapeText`, `slotValue`), and a module that builds would import them for nothing.
 */
function emitMaker(
    sink: Cursor,
    lowering: Lowering,
    markup = (): string => renderMarkup(sink, lowering, CLIENT_LANE),
    anchored = false,
): string {
    // A REGION MADE ONCE IS PARSED. One parse of a whole region costs what building it costs
    // (measured at 86-100% of building it) and ships as the markup string rather than as the code that builds it
    // — building a docs page's own fill was +4.3% gzipped on the whole client for nothing.
    let parsed = !sink.repeated
    for (const at of sink.positions) parsed ||= at.parserOwned
    if (parsed)
        return `return ${lowering.use('markupNodes')}(${DOCUMENT}, ${markup()})`
    return emitBuild(sink, anchored, lowering)
}

/**
 * The body that builds a row's nodes with DOM calls, from the positions `placeTemplate` placed.
 *
 * The same positions the row's mount walks (`emitRegion`), under the same slot names. So a row has
 * one description:
 * the server writes it as bytes, `make` builds it, `mount` finds it, and none of the three can
 * disagree about where a node stands.
 *
 * BUILT RATHER THAN PARSED, and the whole of why: `markupNodes` sets `template.innerHTML` once a
 * row, measured (`bun run bench:reorder`) at ~19 µs a row and ~90% of building a list, and ~88% of
 * it FIXED — what costs is invoking the parser, not parsing. A row that reads PAGE state priced at
 * n=1000 (`selectedRowShare.ts`): 21.6-22.2 ms parsed, 3.5-3.6 ms built, the parsed layer alone
 * longer than a frame. The server is untouched; only a row the browser grows goes through `make`.
 *
 * THE BUILD WRITES WHAT THE MARKUP WRITES, MINUS WHAT THE MOUNT WILL WRITE. `makeRow` calls `make`
 * and then `mount`, so a value the mount binds — a run or an attribute reading a `Reactive` — is
 * written by the binding's first run and the build leaves it: a live run is an empty text node, a
 * live attribute is not set. Everything else takes the value the parser would have made of the
 * server's bytes — `escapeless` for an expression, and the build's own decode for a static one
 * (`decodeCharacterReferences`). A merged `class` or `style` is
 * written whole, through the same structure the markup takes (`mergedValue`), so the two are one
 * string.
 *
 * A BLANK RUN IS BUILT ONLY WHEN IT HAS SOMETHING IN IT, because that is what the server does: a
 * run of expressions that stringify to '' writes no node, and the mount's walk puts one back
 * (`runHere`) exactly where it would for a row the server painted.
 *
 * A NESTED REGION IS AN EMPTY ANCHOR PAIR, filled by its own machinery on the mount's first run
 * (`fillEmpty`), and a component or a slot is the same pair filled by the child.
 */
function emitBuild(row: Cursor, anchored: boolean, lowering: Lowering): string {
    const lines: string[] = ['const __built = []']
    if (anchored)
        lines.push(
            `__built.push(${DOCUMENT}.createComment(${JSON.stringify(ROW_OPEN)}))`,
        )
    const render = buildRender(lowering)
    const into = (at: PlacedNode, node: string): string =>
        at.within === null
            ? `__built.push(${node})`
            : `${at.within.name}.appendChild(${node})`
    for (const at of row.positions) {
        if (at.kind === 'region') {
            lines.push(
                into(
                    at,
                    `${DOCUMENT}.createComment(${JSON.stringify(REGION_OPEN)})`,
                ),
                into(
                    at,
                    `${DOCUMENT}.createComment(${JSON.stringify(REGION_CLOSE)})`,
                ),
            )
            continue
        }
        if (at.kind === 'text') {
            for (const line of builtRun(at, lowering, into)) lines.push(line)
            continue
        }
        lines.push(
            `const ${at.name} = ${DOCUMENT}.createElement(${JSON.stringify(at.tag)})`,
        )
        for (const one of classifyAttributes(
            at.holder as ElementNode,
            lowering,
        )) {
            const value = builtAttribute(one, lowering, render)
            if (value === null) continue
            const set = `${at.name}.setAttribute(${JSON.stringify(one.kind === 'merged' ? one.group?.name : one.attribute.name)}, `
            // 32.37 — a whole-value attribute may be absent, which the server wrote as nothing.
            lines.push(
                one.kind === 'dynamic'
                    ? `{ const __text = ${value}; if (__text !== null) ${set}__text) }`
                    : `${set}${value})`,
            )
        }
        lines.push(into(at, at.name))
    }
    lines.push('return __built')
    return lines.join('\n    ')
}

/**
 * The lines that build one text run of a built row.
 *
 * A RUN, BUILT. What the server writes for a run is its static bytes and each expression escaped —
 * except a `Raw` value (32.26), whose html goes in unescaped, is PARSED into elements, and is
 * anchored (`markupRun`). A text node cannot hold that, so a run whose expression answers a `Raw`
 * is parsed from the very markup the server writes for it, anchors and all — the parser for the one
 * thing only it makes — and every other run is one text node. The check is an `instanceof` a piece,
 * which is what `escapeText` pays already.
 *
 * A run reading a `Reactive` is the mount's to write: an empty node where the run always renders
 * one, and none where it can render none (a blank run), which is what the server leaves too.
 */
function builtRun(
    at: PlacedNode,
    lowering: Lowering,
    into: (at: PlacedNode, node: string) => string,
): string[] {
    const make = (text: string): string =>
        into(at, `${DOCUMENT}.createTextNode(${text})`)
    if (lowering.isLiveRun(at.run)) return at.blank ? [] : [make("''")]
    const lines: string[] = []
    const text: string[] = []
    const markup: string[] = []
    const raw: string[] = []
    for (let piece = 0; piece < at.run.length; piece += 1) {
        const node = at.run[piece] as TemplateNode
        if (node.kind === 'text') {
            text.push(
                JSON.stringify(decodeCharacterReferences(node.text, 'text')),
            )
            markup.push(JSON.stringify(node.text))
            continue
        }
        const value = `${at.name}_${piece}`
        lines.push(`const ${value} = ${lowering.expression(node)}`)
        text.push(`${lowering.use('escapeless')}(${value})`)
        markup.push(`${lowering.use('escapeText')}(${value})`)
        raw.push(`${lowering.use('isRaw')}(${value})`)
    }
    const whole = text.length === 0 ? "''" : text.join(' + ')
    if (raw.length === 0) {
        lines.push(make(whole))
        return lines
    }
    lines.push(
        `if (${raw.join(' || ')}) for (const __made of ${lowering.use('markupNodes')}(${DOCUMENT}, ${RAW_OPEN_MARKUP} + ${markup.join(' + ')} + ${RAW_CLOSE_MARKUP})) ${into(at, '__made')}`,
    )
    if (!at.blank) {
        lines.push(`else ${make(whole)}`)
        return lines
    }
    lines.push(`else if ((${at.name} = ${whole}) !== '') ${make(at.name)}`)
    lines.splice(lines.length - 2, 0, `let ${at.name}`)
    return lines
}

/**
 * One attribute's value as `setAttribute` takes it, or null for one the build leaves alone.
 *
 * What the markup writes, less what the mount writes: 32.5, 32.11 — a bind and a spread are written
 * by their bindings, installed on a built row too, and so is a live value (32.3).
 */
function builtAttribute(
    one: ClassifiedAttribute,
    lowering: Lowering,
    render: ValueRender,
): string | null {
    if (one.kind === 'merged')
        return one.group === undefined
            ? null
            : mergedValue(one.group, lowering, render)
    if (one.kind === 'dynamic')
        return one.live
            ? null
            : `${lowering.use('attributeText')}(${JSON.stringify(one.attribute.name)}, ${lowering.expression(one.attribute)})`
    if (one.kind !== 'static' || one.bytes === undefined) return null
    if (one.attribute.value === '') return "''"
    // 32.28 — a URL attribute's bytes are its value escaped whole, so they decode back to it exactly.
    return render.bytes(one.bytes)
}

/**
 * The build's half of `ValueRender`: what the parser makes of each piece the markup escapes.
 *
 * A merge member reading a `Reactive` is still evaluated here, under 41.4's guard, because a merged
 * attribute is written whole or not at all.
 */
function buildRender(lowering: Lowering): ValueRender {
    const guarded = (attribute: Attribute): string =>
        `${lowering.use('escapeless')}(${unlandable(lowering, attribute, lowering.expression(attribute))})`
    return {
        dynamic: guarded,
        declaration: (attribute) =>
            `${lowering.use('oneStyleValue')}(${guarded(attribute)})`,
        bytes: (bytes) =>
            JSON.stringify(decodeCharacterReferences(bytes, 'attribute')),
    }
}

/**
 * Emits a region's `_build` and `_mount` pair into `helpers`, for a region nobody painted.
 *
 * 32.17 and 32.18 are the same mechanism from two sides — a caller's children handed to a
 * child, and the child's own fallback for a slot nothing was passed — so they are one emitter
 * rather than two that have to be kept byte-compatible by hand.
 */
function emitFillable(
    name: string,
    sink: Cursor,
    region: RegionEmission,
    /**
     * 10.5 — CHILDREN ARE MOUNTED BY THE CHILD, so they are its descendants: the scope current when
     * it mounts them is the one their components find, as it is the one the server built them in.
     * The caller's own is the fallback for a mount with none current.
     */
    children = false,
): void {
    const lowering = region.lowering
    const filled = emitRegion(sink, region.nested())
    region.helpers.push(
        `function ${name}_build(__document) {\n    ${emitMaker(sink, lowering)}\n}`,
    )
    region.helpers.push(
        mountFunction(
            name,
            REGION_ROOT,
            filled.body(),
            `${lowering.use('fillRegion')}(${REGION_ROOT}, ${name}_build)`,
            lowering,
            sink.defersSetup,
            false,
            children
                ? `(${lowering.use('currentShare')}() ?? ${SHARE_AT})`
                : SHARE_AT,
        ),
    )
}

/**
 * The source of a region's `_mount` function, which rebuilds the region on a mismatch.
 *
 * 41.10 — A MISMATCH REBUILDS THIS BLOCK OR ROW AND NOTHING WIDER. What the server wrote is what
 * hydration walks; where it disagrees, it is re-rendered from the same markup a swap or a new row
 * uses (`rebuild`) and wired again. `__rebuilt` is what stops a document that disagrees for some
 * other reason from rebuilding forever — the second failure is the author's to see.
 */
function mountFunction(
    name: string,
    parameters: string,
    body: string[],
    rebuild: string,
    lowering: Lowering,
    resumes: boolean,
    /**
     * 12.13 — the branch-local setup made the scope (`scopedSetup`), holding its watches, and the
     * mount binds into it. A refusal stops only what the mount opened, past `__mark`.
     */
    declared = false,
    /** The share scope a `resumes` mount puts back. */
    resumed = SHARE_AT,
): string {
    // A BODY THAT BINDS NOTHING HAS NOTHING TO STOP AND NOTHING TO REFUSE, so it opens no scope
    // and no `try`: every mount of it answers the one shared empty scope. A static row's two
    // allocations — the `Scope` and its `stops` — are otherwise paid per row for a body that is
    // empty.
    if (body.length === 0)
        return `const ${name}_mount = () => ${declared ? SCOPE : lowering.use('EMPTY_SCOPE')}`
    const mount = [
        declared
            ? `    const __mark = ${SCOPE}.stops.length`
            : `    const ${SCOPE} = new ${lowering.use('Scope')}()`,
        `    try {`,
        ...body.map((line) => `        ${line}`),
        `    } catch (thrown) {`,
        `        ${SCOPE}.stop(${declared ? '__mark' : ''})`,
        `        if (__rebuilt || !${lowering.use('warnMismatch')}(thrown)) throw thrown`,
        `        ${rebuild}`,
        `        return ${name}_mount(${parameters}, true)`,
        `    }`,
        `    return ${SCOPE}`,
    ].join('\n')
    // 10.5 — the instance's own scope, put back for a mount that happens later than its caller's.
    // Only where a component stands below this region: nothing else can read it.
    return `const ${name}_mount = (${parameters}, __rebuilt) => {\n${resumes ? insideShare(lowering, resumed, mount) : mount}\n}`
}

/**
 * Emits a component invocation's client mount: the child mounting itself against its region.
 *
 * 32.17 ON THE CLIENT — the child mounts ITSELF, against the region its markup was written into.
 * The parent hands over the same accessors it handed the server emitter (33.5), so the prop is the
 * caller's expression on both sides and the child re-reads it when the parent's value moves.
 *
 * THE CHILD'S MOUNT IS ITS OWN MODULE'S. `import Total from './Total.abide'` is the default export
 * of the client module that file compiled to (`splitImports`), so the binding the author wrote
 * is the function called here — the parent emits no copy of the child's bindings, and a child
 * changed in place is re-emitted alone.
 */
function emitInvocation(
    at: PlacedNode,
    node: ElementNode,
    region: RegionEmission,
): void {
    const lowering = region.lowering
    const props = invocationProps(node, lowering)
    // 32.18 — THE CHILDREN ARE MARKUP AND A MOUNT, and they have to be both: the markup is what
    // fills a slot the server never painted, and the mount is the CALLER's bindings — which only
    // this module has, addressed from a region only the child knows where to put.
    const children = at.inner[0]
    if (children !== undefined) {
        const kids = region.claim('kd')
        emitFillable(kids, children, region, true)
        props.push(
            `${JSON.stringify(CHILDREN)}: () => ({ build: ${kids}_build, mount: ${kids}_mount })`,
        )
    }
    // THE CHILD'S SCOPE IS OWNED. Its bindings live as long as its nodes do, and what removes
    // those nodes is this region — a row that leaves, an arm that swaps — so the scope that stops
    // them has to be the one this region holds. Held rather than drained, because a child holding
    // an arm or a list of its own owns scopes that its disposer list does not reach.
    //
    // 14.7 — the call runs the child's setup, and nothing it reads subscribes a caller: an arm's
    // swap and a list's rows both mount untracked (`ArmRegion`, `updateList`).
    const chosen = lowering.chosenTag(node)
    if (chosen === undefined) {
        region.lines.push(
            `${SCOPE}.own(${node.tag}(${lowering.use('regionFound')}(${at.name}), { ${props.join(', ')} }))`,
        )
        return
    }
    // 32.34, 32.35 — A TAG CHOOSING BY A VALUE IS AN `{#if}` WHOSE ARMS ARE COMPONENTS
    // (`ChosenRegion`): the watch reads which, and the region swaps.
    const name = region.claim('dc')
    region.lines.push(`const ${name} = new ${lowering.use('ChosenRegion')}(${lowering.use('regionFound')}(${at.name}), ${SCOPE}, { ${props.join(', ')} }, ${SHARE_AT})
${SCOPE}.watch(() => ${name}.show(${chosen}))`)
}

/**
 * Emits a `<slot/>`'s client unit: the caller's children, or the child's own fallback.
 *
 * 32.18 ON THE CHILD'S SIDE — the position the caller's children render into. Not a watch and not
 * a swap: whether children were given is fixed at the call site, so this is read once and the
 * region holds whichever of the two was decided there for the rest of its life.
 *
 * THE FALLBACK IS THE CHILD'S OWN, so it is emitted here as an arm is — its markup for a region
 * nobody painted, its bindings for one somebody did.
 */
function emitSlot(at: PlacedNode, region: RegionEmission): void {
    const lowering = region.lowering
    const name = region.claim('sl')

    emitFillable(name, at.inner[0] as Cursor, region)

    // THE EMPTY REGION IS THE ONE THE SERVER DID NOT PAINT — a child built in the browser (32.17)
    // or a page navigated to (30.7). Filled from whichever side owns what goes there, and then
    // mounted from the same side, so the markup and the bindings can never come from two.
    region.lines.push(`const ${name} = ${lowering.use('regionFound')}(${at.name})
const ${name}_kids = ${PROPS}[${JSON.stringify(CHILDREN)}] === undefined ? undefined : ${PROPS}[${JSON.stringify(CHILDREN)}]()
${lowering.use('fillEmpty')}(${name}, ${name}_kids === undefined ? ${name}_build : ${name}_kids.build)
${SCOPE}.own(${name}_kids === undefined ? ${name}_mount(${name}) : ${name}_kids.mount(${name}))`)
}

/**
 * Emits an `{#if}` chain's client unit, which hydrates the arm the server rendered.
 *
 * 32.12 — one arm renders. The SERVER already rendered one, so the first run HYDRATES it rather
 * than replacing it: a page that re-renders every region on load creates every node twice and
 * throws away the document it was sent. The condition is evaluated once a run, the first run
 * included — the arm hydrated is the arm the watch then compares against.
 */
function emitBlock(
    at: PlacedNode,
    block: Extract<TemplateNode, { kind: 'block'; block: 'if' }>,
    region: RegionEmission,
): void {
    const lowering = region.lowering
    const name = region.claim('rg')

    // `{:else}` carries no condition and is the floor; with no `{:else}` the floor is one arm past
    // the last, which builds nothing and binds nothing.
    const floor = block.branches.at(-1)?.subject !== ''
    const take = chosenArm(
        block.branches,
        lowering,
        String,
        String(block.branches.length),
    )
    const mounted = emitArms(
        name,
        at,
        region,
        undefined,
        block.branches.map((branch) => branch.setup),
        floor,
    )
    // ONE UNIT: `${name}` is read by the watch below, and a caller that guards its units apart
    // (`emitClient`) would put a `const` in one block and its only reader in the next. Every name a
    // unit declares is read inside it — that is what makes a unit independent, and it is the
    // property the page's per-binding guard rests on. What a swap does is `ArmRegion`'s.
    //
    // 14.2 — A CHAIN WHOSE EVERY SUBJECT IS PROVEN STATIC IS DECIDED ONCE, outside any watch: the arm
    // it takes can never change, and a watch over it is a reader that can never wake. Unproven, the
    // watch stays, and tracking decides what it reads.
    const show = `${name}.show(${take})`
    region.lines.push(`const ${name} = new ${lowering.use('ArmRegion')}(${lowering.use('regionFound')}(${at.name}), ${SCOPE}, ${name}_arms, ${mounted})
${lowering.isLiveChain(block.branches) ? `${SCOPE}.watch(() => ${show})` : show}`)
}

/**
 * Emits a `{#try}` block's client unit: the body until something in it fails, then the catch.
 *
 * 32.16 — A `{#try}` TAKES ITS BODY UNTIL SOMETHING IN IT FAILS, and its catch from then until the
 * failure clears. The boundary is the region's, and the catch reads the failure by the name the
 * author bound. Two arms, so the arm taken is `0` or `1` and never the `{#if}` floor.
 */
function emitTry(
    at: PlacedNode,
    block: Extract<TemplateNode, { kind: 'block'; block: 'try' }>,
    region: RegionEmission,
): void {
    const lowering = region.lowering
    const name = region.claim('rg')
    // HANDED IN, not read off the boundary: the arms are hoisted where the region's own names are
    // out of reach, and each instance has a failure of its own. The catch's binding is its setup.
    emitArms(
        name,
        at,
        region,
        block.error === '' ? '' : `const ${block.error} = __caught`,
        undefined,
        false,
    )

    // ONE UNIT, for `emitBlock`'s reason. What the body and the catch do is `TryRegion`'s.
    region.lines.push(`const ${name} = new ${lowering.use('TryRegion')}(${lowering.use('regionFound')}(${at.name}), ${SCOPE}, ${name}_arms)
${SCOPE}.watch(() => ${name}.follow())`)
}

/**
 * Emits a block's arm builders into `helpers`; returns whether any arm has a mount.
 *
 * A BLOCK'S ARMS, each set up the way `List.setUp` sets up a row: `${name}_arms[arm]` is called once
 * each time that arm is swapped in, and answers the arm's `{ build, mount }`. An arm with a setup of
 * its own — a branch-local `<script>` (14.8), or the `{#try}` catch's binding of the failure it is
 * handed — declares its builder and mount after it, so both close over its names; every other arm
 * answers the one record built with the region. With `floor`, one more arm past the last builds
 * nothing and binds nothing: the `{#if}` with no `{:else}` and no subject true.
 */
function emitArms(
    name: string,
    at: PlacedNode,
    region: RegionEmission,
    /** The `{#try}` catch's binding, `''` where it binds no name; `undefined` for an `{#if}`. */
    caught: string | undefined,
    /** 14.8 — each `{#if}` arm's branch-local `<script>`, or `null`. */
    setups: readonly (Setup | null)[] | undefined,
    floor: boolean,
): boolean {
    const lowering = region.lowering
    const helpers = region.helpers
    const fillRegion = lowering.use('fillRegion')
    const arms: string[] = []
    // A `{#try}` always mounts: its catch binds the failure, and its body mounts under the boundary.
    let mounted = caught !== undefined
    for (let arm = 0; arm < at.inner.length; arm += 1) {
        const sink = at.inner[arm] as Cursor
        const own = `${name}_a${arm}`
        // A NESTED REGION'S HELPERS BELONG TO THE SCOPE THAT OWNS THEM. Hoisted to `mount` they
        // read names this arm binds and nothing else does, which is a ReferenceError at the first
        // swap rather than at compile time. AND SO DOES ITS WALK, for the same reason: each arm's
        // mount is a function of its own, so two arms may name a slot `__c0` and neither can see
        // the other's.
        const body = emitRegion(sink, region.nested()).body()
        if (body.length > 0) mounted = true
        const setup = setups?.[arm] ?? null
        // 12.13 — AN ARM WITH A `<script>` HAS SOMETHING TO STOP even where it binds nothing: the
        // watches that script opened, in the scope its mount answers to the block.
        if (setup !== null) mounted = true
        const local =
            setup !== null
                ? lowering.setup(setup)
                : arm === 1 && caught !== undefined
                  ? caught
                  : ''
        const builders = `const ${own}_build = function (__document) {\n${emitMaker(sink, lowering)}\n}\n${mountFunction(own, REGION_ROOT, body, `${fillRegion}(${REGION_ROOT}, ${own}_build)`, lowering, sink.defersSetup, setup !== null)}`
        if (local === '') {
            helpers.push(
                `${builders}\nconst ${own}_arm = { build: ${own}_build, mount: ${own}_mount }`,
            )
            arms.push(`() => ${own}_arm`)
        } else if (setup === null)
            arms.push(
                `(__caught) => {\n${local}\n${builders}\nreturn { build: ${own}_build, mount: ${own}_mount }\n}`,
            )
        else {
            const owning = scopedSetup(local, lowering, true)
            arms.push(
                `(__caught) => {\n${owning.opened}${local}\n${owning.handed}${builders}\nreturn { build: ${own}_build, mount: ${own}_mount }${owning.closed}\n}`,
            )
        }
    }
    if (floor) {
        helpers.push(
            `const ${name}_floor = { build: undefined, mount: () => ${lowering.use('EMPTY_SCOPE')} }`,
        )
        arms.push(`() => ${name}_floor`)
    }
    helpers.push(`const ${name}_arms = [\n${arms.join(',\n')}\n]`)
    return mounted
}

/**
 * Emits a `{#for}` list's client unit, which hydrates the rows the server rendered.
 *
 * 32.13 — the list. The server already rendered the rows, so the first update HYDRATES them:
 * every row's element is already in the document and only its bindings are missing. Only a change
 * to the list reconciles, and only the rows that moved move.
 *
 * 32.21 — the subject is read ONCE for the block. 32.22 — an absent subject iterates zero times.
 */
function emitList(
    position: PlacedNode,
    block: ForBlock,
    region: RegionEmission,
): void {
    const lowering = region.lowering
    const name = region.claim('ls')

    const row = position.inner[0] as Cursor
    const subject = lowering.expression(block)
    // THE ROW BINDS ITS OWN NAME. Every emitted row function takes the author's item and index as
    // its parameters, so the body's expressions read exactly what the author wrote and nothing
    // rewrites already-emitted source — a rename by regex reaches inside static text and cannot
    // reach a nested region's helper at all.
    const item = block.item
    const at = block.index === '' ? '__at' : block.index
    // 41.8 — with no `by`, the key is the POSITION, which is 32.13's positional reconcile: a row
    // is whatever is in that slot, and a reorder rewrites the rows rather than moving them.
    // 31.10 — the item and the index SHADOW the page's names for the row, and the projection is
    // what says so: they are a `for … of` binding there, so no read in the body or the key reaches
    // the page's name of the same spelling.
    const written = `(${item}, ${at}) => ${block.key === '' ? at : lowering.key(block)}`
    // 32.32 — ONLY A NAME ALONE hands the list its `Reactive`. Any other subject is a value computed
    // from one, which declared no `by` of its own, and evaluating it a second time to ask would run
    // the computation twice. `reference` keeps the name the `Reactive` (31.3) rather than a read.
    const key =
        block.key === '' && isNamedAlone(block.subject.trim())
            ? `${lowering.use('rowKeyOf')}(${lowering.reference(block)}, ${written})`
            : written

    const single = isSingleRooted(block.children)

    const rowRegion = emitRegion(row, region.nested())

    // `List` hands the row its document — see `emitMaker` for which rows are parsed instead.
    const make = `const ${name}_make = (__document, ${item}, ${at}) => {\n    ${emitMaker(row, lowering, () => rowMarkup(row, !single, lowering, CLIENT_LANE), !single)}\n}`

    // A row that cannot be hydrated is REBUILT by the same `make`, in place, and the row's record
    // takes its new first node.
    const builders = [
        make,
        mountFunction(
            name,
            `${ROW_ROOT}, ${item}, ${at}`,
            // The row's walk, INSIDE the mount's one `try` rather than above it, because a row
            // rebuilds whole: a node that refused is the row disagreeing, and re-making it is the
            // answer the page does not have.
            rowRegion.body(),
            `${lowering.use('replaceRow')}(${ROW_ROOT}, ${name}_make(${ROW_ROOT}.node.ownerDocument, ${item}, ${at}))`,
            lowering,
            row.defersSetup,
            block.setup !== null,
        ),
    ].join('\n')
    // THE LIST CALLS `_setUp` ONCE PER ROW (`List.setUp`). 14.8 — a row with a branch-local
    // `<script>` runs it there, and the row's `make` and `mount` are declared after it, so both close
    // over its names and neither runs it again. Every other row gets the list's one record back.
    region.helpers.push(
        [
            // What the subject iterates as is `listOf`'s question, asked inside the runtime.
            `const ${name}_subject = () => ${subject}`,
            `const ${name}_key = ${key}`,
            block.setup !== null
                ? rowSetUp(
                      name,
                      item,
                      at,
                      lowering.setup(block.setup),
                      builders,
                      lowering,
                  )
                : `${builders}\nconst ${name}_builders = { make: ${name}_make, mount: ${name}_mount }\nconst ${name}_setUp = () => ${name}_builders`,
        ].join('\n'),
    )

    // ONE UNIT, for `emitBlock`'s reason: the list's region and the `List` built over it are both
    // read by the watch, so the three lines cannot be guarded apart.
    // OWNED BY THE REGION ABOVE IT: `dropRow` stops a row as the list churns, but a block removed
    // whole drops no rows, so `List.stop` is what reaches the ones still standing.
    region.lines.push(
        `const ${name} = ${lowering.use('regionFound')}(${position.name})
const ${name}_list = ${SCOPE}.own(${lowering.use('listAt')}(${name}, ${single ? 'false' : 'true'}, ${name}_key, ${name}_setUp))
${SCOPE}.watch(() => ${lowering.use('updateList')}(${name}_list, ${name}_subject()))`,
    )
}

/**
 * A row's `_setUp` where the row has a branch-local `<script>` (14.8): runs it once for the row,
 * and answers the builders that close over its names.
 *
 * 12.13 — the watches the script opened are the row's, in the scope its mount binds into.
 */
function rowSetUp(
    name: string,
    item: string,
    at: string,
    local: string,
    builders: string,
    lowering: Lowering,
): string {
    const owning = scopedSetup(local, lowering, true)
    // The mount takes the setUp's own item and index again, shadowing them with the same values, so
    // the row record `List` hands in is the only thing that is new.
    return `const ${name}_setUp = (${item}, ${at}) => {
${owning.opened}${local}
${owning.handed}${builders}
return { make: ${name}_make, mount: ${name}_mount }${owning.closed}
}`
}
